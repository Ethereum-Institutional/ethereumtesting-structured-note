import { trySnapshot } from "@/lib/data";
import { Panel } from "@/components/ui";
import { HoldersTable } from "@/components/HoldersTable";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** The holders of record, their on-chain passports, and the freeze button. Nothing else. */
export default async function InvestorsPage() {
  const { data: s, reason } = await trySnapshot();
  if (!s) {
    return <p className="text-xs" style={{ color: "var(--bad)" }}>{reason}</p>;
  }
  return (
    <div data-tour="investors">
      <Panel
        title="Investors"
        subtitle="Each passport is an ONCHAINID contract the pool checks on every order — read live from the identity registry"
      >
        <HoldersTable holders={s.holders} symbol={s.asset.symbol} />
      </Panel>
    </div>
  );
}
