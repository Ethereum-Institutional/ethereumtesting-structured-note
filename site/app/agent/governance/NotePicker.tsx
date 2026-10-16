import type { GovernedNote } from "@/lib/governance";

/**
 * Which note the acts below are for: every act names its note, so the choice is made first and
 * shown plainly. A plain form, so it works before the page's script has loaded.
 */
export function NotePicker({ notes, chosen }: { notes: GovernedNote[]; chosen: string }) {
  return (
    <form method="get" className="note-picker" aria-label="Choose the note">
      <label>
        Note
        <select name="note" defaultValue={chosen}>
          {notes.map((n) => <option key={n.address} value={n.address}>{n.symbol}: {n.name}</option>)}
        </select>
      </label>
      <button type="submit" className="quiet">Show</button>
      <span className="muted">The controller governs {notes.length} note{notes.length === 1 ? "" : "s"}.</span>
    </form>
  );
}
