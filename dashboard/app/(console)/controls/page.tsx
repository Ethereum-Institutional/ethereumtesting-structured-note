import { controlsState } from "@/lib/data";
import { Panel } from "@/components/ui";
import { Controls } from "@/components/Controls";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** The compliance levers: pause, trading, jurisdictions. Each one is a public contract call. */
export default async function ControlsPage() {
  let c;
  try {
    c = await controlsState();
  } catch {
    return <p className="text-xs" style={{ color: "var(--bad)" }}>Cannot reach the chain.</p>;
  }
  return (
    <div data-tour="controls">
      <Panel
        title="Compliance controls"
        subtitle="Each lever sends one Solidity call — the receipt shows the call, the transaction, and the state read back"
      >
        <Controls
          paused={c.paused}
          swappingEnabled={c.swappingEnabled}
          enforceCountry={c.enforceCountry}
          countries={c.countries}
          contracts={c.contracts}
        />
      </Panel>
    </div>
  );
}
