// Activity: every transaction in a month, grouped the way you made it.
//   a paycheck (income event)   → one row, with its split
//   a move / transfer pair      → one row, from → to
//   Assign (several move pairs saved together from one Unassigned) → one row
//   a card spend (3 rows)       → one row: the envelope's spend, "on Visa"
//   a card payment (2 rows)     → one row
//   anything else               → one row each (spends, starting balances, adjustments)
// Pure: data in, rows out. Nothing here talks to the database.

const round = (n) => Math.round(n * 100) / 100

// lookups: { cats: {id → {name, accountId, isUnassigned}}, accounts: {id → {name, kind, bankId}},
//            banks: {id → {name, currency}}, sources: {id → {name, accountId}} }
export function groupActivity(transactions, events, lookups) {
  const { cats, accounts, banks, sources } = lookups
  const where = (catId) => {
    const c = cats[catId]
    const a = c ? accounts[c.accountId] : null
    return { cat: c, account: a, bankId: a?.bankId ?? null, bank: a ? banks[a.bankId] : null }
  }
  const itemName = (catId) => {
    const c = cats[catId]
    if (!c) return 'Deleted item'
    return c.isUnassigned ? `Unassigned (${accounts[c.accountId]?.name ?? '?'})` : c.name
  }

  const rows = []
  const byEvent = {}
  const byPair = {}
  for (const t of transactions) {
    if (t.income_event_id) (byEvent[t.income_event_id] ??= []).push(t)
    else if (t.pair_id) (byPair[t.pair_id] ??= []).push(t)
    else rows.push(single(t))
  }

  function single(t) {
    const w = where(t.category_id)
    const type = t.kind === 'spend' ? 'spend' : t.kind === 'income' ? 'income' : 'other'
    return {
      key: t.id,
      type,
      date: t.occurred_on,
      created: t.created_at,
      title: t.kind === 'opening' ? (t.note || 'Balance adjustment') : itemName(t.category_id),
      detail: t.kind === 'opening' ? itemName(t.category_id) : t.note || '',
      amount: t.amount,
      bankIds: [w.bankId],
      currency: w.bank?.currency,
      accountName: w.account?.name,
      del: t.debt_id ? { debtPayment: t.id } : { ids: [t.id] },
      debt: !!t.debt_id,
      search: [itemName(t.category_id), t.note, w.account?.name].join(' '),
    }
  }

  // Paychecks
  for (const e of events) {
    const tx = byEvent[e.id] ?? []
    const src = sources[e.source_id]
    const landing = src ? accounts[src.accountId] : null
    const net = {}
    tx.forEach((t) => (net[t.category_id] = (net[t.category_id] ?? 0) + t.amount))
    const lines = Object.entries(net)
      .filter(([, v]) => round(v) > 0)
      .map(([id, v]) => ({ name: itemName(id), amount: round(v), bankName: where(id).bank?.name }))
      .sort((a, b) => b.amount - a.amount)
    const bankIds = [...new Set([landing?.bankId, ...tx.map((t) => where(t.category_id).bankId)].filter(Boolean))]
    rows.push({
      key: `event-${e.id}`,
      type: 'income',
      date: e.received_on,
      created: e.created_at,
      title: src?.name ?? 'Income',
      detail: [e.note, lines.length > 1 ? `split into ${lines.length} items` : lines[0] ? `to ${lines[0].name}` : ''].filter(Boolean).join(' · '),
      amount: e.amount,
      bankIds,
      currency: landing ? banks[landing.bankId]?.currency : undefined,
      accountName: landing?.name,
      lines,
      del: { eventId: e.id },
      search: [src?.name, e.note, ...lines.map((l) => l.name)].join(' '),
    })
  }

  // Pairs: card spends, card payments, moves and transfers. Assign pairs saved together merge.
  const assignGroups = {}
  for (const [pairId, tx] of Object.entries(byPair)) {
    const kinds = new Set(tx.map((t) => t.kind))
    const date = tx[0].occurred_on
    if (kinds.has('card')) {
      // card spend: the envelope's 'spend' row is what you spent
      const spend = tx.find((t) => t.kind === 'spend') ?? tx[0]
      const ledger = tx.find((t) => t.kind === 'card')
      const card = ledger ? accounts[cats[ledger.category_id]?.accountId] : null
      const w = where(spend.category_id)
      rows.push({
        key: pairId,
        type: 'spend',
        date,
        created: spend.created_at,
        title: itemName(spend.category_id),
        detail: [spend.note && !spend.note.startsWith('Paid with') ? spend.note : '', card ? `on ${card.name}` : 'on a card'].filter(Boolean).join(' · '),
        amount: spend.amount,
        bankIds: [...new Set([w.bankId, card?.bankId].filter(Boolean))],
        currency: w.bank?.currency,
        accountName: w.account?.name,
        del: { pairs: [pairId] },
        search: [itemName(spend.category_id), spend.note, card?.name].join(' '),
      })
      continue
    }
    if (kinds.has('card_payment')) {
      const out = tx.find((t) => t.amount < 0) ?? tx[0]
      const into = tx.find((t) => t.amount > 0)
      const card = into ? accounts[cats[into.category_id]?.accountId] : null
      const w = where(out.category_id)
      rows.push({
        key: pairId,
        type: 'card',
        date,
        created: out.created_at,
        title: `Paid ${card?.name ?? 'card'}`,
        detail: `from ${itemName(out.category_id)}`,
        amount: out.amount,
        bankIds: [...new Set([w.bankId, card?.bankId].filter(Boolean))],
        currency: w.bank?.currency,
        accountName: w.account?.name,
        del: { pairs: [pairId] },
        search: [card?.name, itemName(out.category_id), out.note].join(' '),
      })
      continue
    }
    const from = tx.find((t) => t.amount < 0)
    const to = tx.find((t) => t.amount > 0)
    if (!from || !to) {
      tx.forEach((t) => rows.push(single(t)))
      continue
    }
    // Assign: many pairs from one Unassigned, saved in one go (same note, time and source).
    if (from.note === 'Assigned' && cats[from.category_id]?.isUnassigned) {
      const k = `${from.category_id}|${from.created_at}`
      const g = (assignGroups[k] ??= { from, pairs: [], lines: [] })
      g.pairs.push(pairId)
      g.lines.push({ name: itemName(to.category_id), amount: round(to.amount) })
      continue
    }
    const wf = where(from.category_id)
    const wt = where(to.category_id)
    const crossBank = wf.bankId !== wt.bankId
    rows.push({
      key: pairId,
      type: 'move',
      date,
      created: from.created_at,
      title: `${itemName(from.category_id)} → ${itemName(to.category_id)}`,
      detail: [from.note, from.kind === 'transfer' ? (crossBank ? `${wf.bank?.name} to ${wt.bank?.name}` : 'between accounts') : ''].filter(Boolean).join(' · '),
      amount: -from.amount,
      received: crossBank && round(to.amount) !== round(-from.amount) ? to.amount : null,
      receivedCurrency: wt.bank?.currency,
      bankIds: [...new Set([wf.bankId, wt.bankId].filter(Boolean))],
      currency: wf.bank?.currency,
      accountName: wf.account?.name,
      del: { pairs: [pairId] },
      search: [itemName(from.category_id), itemName(to.category_id), from.note].join(' '),
    })
  }
  for (const g of Object.values(assignGroups)) {
    const w = where(g.from.category_id)
    const total = round(g.lines.reduce((n, l) => n + l.amount, 0))
    rows.push({
      key: `assign-${g.pairs[0]}`,
      type: 'move',
      date: g.from.occurred_on,
      created: g.from.created_at,
      title: `Assigned from Unassigned`,
      detail: g.lines.length === 1 ? `to ${g.lines[0].name}` : `to ${g.lines.length} items`,
      amount: total,
      bankIds: [w.bankId],
      currency: w.bank?.currency,
      accountName: w.account?.name,
      lines: g.lines.sort((a, b) => b.amount - a.amount),
      del: { pairs: g.pairs },
      search: ['Assigned', ...g.lines.map((l) => l.name)].join(' '),
    })
  }

  // Newest first: by date, then the order they were saved.
  return rows.sort((a, b) => b.date.localeCompare(a.date) || (b.created ?? '').localeCompare(a.created ?? ''))
}
