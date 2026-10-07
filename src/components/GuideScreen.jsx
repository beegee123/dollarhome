import { Link } from 'react-router'

// The in-app user guide: the same content as the "DollarHome User Guide" doc,
// one folded section per topic so it's quick to scan on a phone.
export default function GuideScreen() {
  return (
    <div className="screen">
      <header className="screen-header screen-header--sub">
        <Link to="/" className="back-link">
          ← Budget
        </Link>
        <span className="eyebrow">DOLLARHOME</span>
        <h1>Guide</h1>
      </header>

      <p className="guide-lead">
        A simple envelope budget: every dollar gets a home, paychecks fill the homes, spending empties them, and nothing
        resets at month end.
      </p>

      <main className="guide-list">
        <Section title="How DollarHome thinks" open>
          <table className="guide-table">
            <thead>
              <tr>
                <th>Level</th>
                <th>What it is</th>
                <th>Where you see it</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Bank</td>
                <td>A real bank, with one currency</td>
                <td>A tab on Budget</td>
              </tr>
              <tr>
                <td>Account</td>
                <td>Checking, Savings, or a credit card</td>
                <td>A section on the tab</td>
              </tr>
              <tr>
                <td>Budget item</td>
                <td>A purpose for money (Rent, Vacation)</td>
                <td>A row with a bar</td>
              </tr>
            </tbody>
          </table>
          <ul>
            <li>
              <strong>Balances are never typed in.</strong> An item’s balance is everything that happened to it: income
              in, spending out, moves.
            </li>
            <li>
              <strong>Unassigned</strong> is built into every account: money waiting for a home. It only shows when it
              holds money.
            </li>
            <li>
              <strong>Carry-over:</strong> nothing resets at month end.
            </li>
            <li>
              <strong>One currency per bank.</strong> USD and CAD are never added together, and money only moves within
              one currency.
            </li>
          </ul>
        </Section>

        <Section title="Getting started">
          <ol>
            <li>Add your banks (Setup), each with its currency.</li>
            <li>Add accounts with today’s balance. It goes into Unassigned.</li>
            <li>Add budget items to each account, with a target.</li>
            <li>On Budget, tap Assign on Unassigned and give each dollar a home.</li>
            <li>Set up income sources: where each paycheck lands and how it splits.</li>
            <li>Optional: credit cards, loans and tax bills (Owed), wishlist items.</li>
          </ol>
          <p className="hint">Start with one bank and one account for a week, then add the rest.</p>
        </Section>

        <Section title="Everyday use">
          <dl className="guide-dl">
            <dt>Log a spend</dt>
            <dd>Tap an item, type the amount, Log spend. Used a card? Pick it under Paid with.</dd>
            <dt>Payday</dt>
            <dd>
              + Income in → pick the source → check the amount → edit any line → Apply. Leftover goes to Unassigned.
            </dd>
            <dt>Assign</dt>
            <dd>Tap Assign on an Unassigned row. Fill tops an item up to its plan (or a goal’s share this month).</dd>
            <dt>Move</dt>
            <dd>Move (bottom bar) sends money between items in the same currency.</dd>
          </dl>
          <p>
            <strong>Fixed vs percent splits.</strong> Salaries use fixed amounts. Income that varies, like the STR, uses
            percentages that add up to 100. Any line can be changed for one paycheck.
          </p>
          <p>
            <strong>Total per account.</strong> While editing a split, each account shows its total, and the Total per
            account box says how much to move at your bank (e.g. “move $400 to Savings from Checking”). For a percent
            split, type a sample payout to see it in dollars.
          </p>
          <p>
            <strong>Moves vs transfers.</strong> Within one account nothing changes at the bank. Between accounts you get
            a reminder to move the money in your bank app; tap Done ✓ once you have. A split can also send part of a
            paycheck to another bank in the same currency (e.g. RBC to Scotia); that reminder says “bank-to-bank” since
            it takes a few days.
          </p>
        </Section>

        <Section title="Staying in step with your bank">
          <ul>
            <li>
              Each account shows <span className="match-ok">Matches bank</span> or{' '}
              <span className="match-off">Off by $X vs bank</span>.
            </li>
            <li>Tap it and type what your bank app shows. Less in the bank usually means an unlogged spend; more, unlogged income.</li>
            <li>
              If you moved money since your last update, the sheet lists those moves with tick boxes. Tick one to add or
              subtract exactly that amount from your last balance, so you don’t have to type it. You can still edit the number.
            </li>
            <li>Save balance only records the bank’s number; it never moves money between items.</li>
            <li>
              Know the bank is right (old sample numbers, a restart)? Use <strong>Save and adjust to match</strong>: the
              difference goes into Unassigned so the account matches.
            </li>
            <li>Credit cards have the same check against the card statement.</li>
          </ul>
        </Section>

        <Section title="Targets and tags">
          <p>
            Each item is <strong>Monthly</strong> (what you aim to have each month) or <strong>Save up by a date</strong>{' '}
            (a goal or a bill). Targets set how full the bar looks; they never move money.
          </p>
          <table className="guide-table">
            <thead>
              <tr>
                <th>Tag</th>
                <th>Means</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="tag-ok">Funded / +$X</td>
                <td>At or above the target</td>
              </tr>
              <tr>
                <td className="tag-ok">On track</td>
                <td>Monthly item at 30–99% of plan</td>
              </tr>
              <tr>
                <td className="tag-ok">$350/mo to Jun 2027</td>
                <td>Goal on the way: put about this in each month</td>
              </tr>
              <tr>
                <td className="tag-low">Low</td>
                <td>Monthly item under 30% of plan</td>
              </tr>
              <tr>
                <td className="tag-low">Due soon</td>
                <td>Goal in its final month, still short</td>
              </tr>
              <tr>
                <td className="tag-empty">Empty / Overspent</td>
                <td>$0, or below $0</td>
              </tr>
              <tr>
                <td className="tag-empty">Past due</td>
                <td>Goal date passed, not funded</td>
              </tr>
            </tbody>
          </table>
          <p className="hint">Reaching a goal or paying off a debt gets a celebration.</p>
        </Section>

        <Section title="Wishlist">
          <ol>
            <li>Add an item, its price, and the envelope it will come from.</li>
            <li>Tap items to select them: each envelope shows Enough or Short, then Ready or Not yet.</li>
            <li>Mark bought turns them into spends from their envelopes. Put back undoes it.</li>
          </ol>
        </Section>

        <Section title="Owed: loans and tax bills">
          <ul>
            <li>
              Setup → Owed. Add a loan or tax bill with the envelope it’s paid from, the amount owed, and an optional due
              date.
            </li>
            <li>
              Pay records a spend from the envelope and lowers what’s owed. For a loan, enter the interest part ($ from
              your statement, or % a year to have it worked out); only the rest lowers what’s owed.
            </li>
            <li>Update owed is for interest or a new statement; it moves no money.</li>
            <li>Tip: give a tax bill’s envelope a Save up by a date target with the same amount and date.</li>
          </ul>
        </Section>

        <Section title="Credit cards">
          <p>
            A card spend comes out of your budget right away, but the money stays in your bank until you pay the bill — so
            it’s parked in the card’s payment envelope.
          </p>
          <table className="guide-table">
            <thead>
              <tr>
                <th>Action</th>
                <th>Groceries</th>
                <th>Visa payment</th>
                <th>Visa owes</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Spend $50 with Visa</td>
                <td>−$50</td>
                <td>+$50</td>
                <td>+$50</td>
              </tr>
              <tr>
                <td>Pay card $50</td>
                <td>—</td>
                <td>−$50</td>
                <td>−$50</td>
              </tr>
            </tbody>
          </table>
          <p className="hint">Checking still matches the bank after a card spend, because nothing left it yet.</p>

          <h3>Add a card</h3>
          <ol>
            <li>Setup → under the bank that issues the card (same currency as the account you pay it from) → + Add account or card.</li>
            <li>Switch to Credit card and type the card’s name, like Visa.</li>
            <li>Owed today: the current balance from your card app (everything owed, not just this month’s statement). Leave it blank for $0.</li>
            <li>Paid from: the bank account you pay the bill from.</li>
            <li>Tap Add card. DollarHome adds a “Visa payment” envelope to that account and a CARD section on the bank’s tab. A card holds no budget items of its own.</li>
          </ol>
          <p>
            Added it as a bank account by mistake? Setup → the account → Account settings → Change to a credit card. Type what it
            owes and choose the account that pays it. This only works while the account has no budget items, no income source
            landing in it and no activity; otherwise archive it and add the card fresh.
          </p>

          <h3>A card that already has a balance</h3>
          <p>
            That debt is already on the card, but no money is set aside for it yet, so “Visa payment” starts empty and shows
            as short. Give it money with Assign (from Unassigned) or Move (from other envelopes), as much as you can now,
            and top it up as paychecks come in. When it covers what the card owes, it shows “covered”.
          </p>

          <h3>Spend on the card</h3>
          <p>
            Tap a budget item as usual, enter the amount, and under Paid with pick the card instead of Bank. The item drops,
            the payment envelope goes up and the card owes more. Delete a past spend from the item’s Recent list to undo it.
          </p>

          <h3>Pay the card</h3>
          <p>
            On the card’s section tap Pay card. The amount starts at what the card owes, or what the payment envelope holds
            if that’s less. Change the amount or date and save, then make the same payment in your bank app. You can’t
            pay more than the card owes. If the envelope holds less than the payment, DollarHome warns you and lets it go
            below zero.
          </p>

          <h3>Update the balance</h3>
          <p>
            Paying lowers what DollarHome says you owe, but the statement number stays as you last typed it. After a payment, a
            new statement or interest, tap Update on the card’s match line, type what your card app says you owe, and
            choose:
          </p>
          <ul>
            <li>Save and adjust to match: DollarHome’s “owes” figure is changed to your number. Use this for an unlogged purchase or interest.</li>
            <li>Save balance only: records your number without changing what DollarHome says. Use this if you expect to log the missing items yourself.</li>
          </ul>
          <p className="hint">Green “Matches statement” means the two agree.</p>
        </Section>

        <Section title="Analytics">
          <ul>
            <li>One bank and one month at a time; ‹ › steps back up to a year.</li>
            <li>Where it went: spending per item, with a tick at the monthly plan; amber went over.</li>
            <li>Income by source, a 6-month spending line, Owed progress, and Wishlist progress.</li>
          </ul>
        </Section>

        <Section title="Housekeeping">
          <ul>
            <li>Undo appears for 6 seconds after most actions. A past spend can be deleted from the item’s Recent list.</li>
            <li>Archive hides banks, accounts and items without losing history; only empty ones can be archived.</li>
            <li>
              Item in the wrong account? Setup → the account → tap the item → Move to another account. It brings its money
              and history; then move the money in your bank app.
            </li>
            <li>
              Setup → Reset: Restart balances (keep setup, clear activity), Delete one bank, or Delete everything.
            </li>
            <li>Setup → Bill notes is one running note for anything to remember about bills. Use the buttons above it for bold, italic, strikethrough, bullets, numbering and checklists (a ticked item is struck through). It saves as you type.</li>
            <li>Sign out is at the bottom of Setup.</li>
          </ul>
        </Section>
      </main>
    </div>
  )
}

function Section({ title, open = false, children }) {
  return (
    <details className="guide-section" open={open}>
      <summary>{title}</summary>
      <div className="guide-body">{children}</div>
    </details>
  )
}
