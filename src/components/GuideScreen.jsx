import { Link } from 'react-router'

// The in-app user guide: the same content as the "DollarHome User Guide" doc,
// one folded section per topic so it's quick to scan on a phone.
export default function GuideScreen() {
  return (
    <div className="screen">
      <header className="screen-header screen-header--sub">
        <Link to="/setup" className="back-link">
          ← Setup
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
            <strong>Moves vs transfers.</strong> Within one account nothing changes at the bank. Between accounts you get
            a reminder to move the money in your bank app; tap Done ✓ once you have.
          </p>
        </Section>

        <Section title="Staying in step with your bank">
          <ul>
            <li>
              Each account shows <span className="match-ok">Matches bank</span> or{' '}
              <span className="match-off">Off by $X vs bank</span>.
            </li>
            <li>Tap it and type what your bank app shows. Less in the bank usually means an unlogged spend; more, unlogged income.</li>
            <li>Updating the bank balance never moves money between items.</li>
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
            <li>Add a loan or tax bill with the envelope it’s paid from, the amount owed, and an optional due date.</li>
            <li>Pay records a spend from the envelope and lowers what’s owed.</li>
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
              Setup → Reset: Restart balances (keep setup, clear activity), Delete one bank, or Delete everything.
            </li>
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
