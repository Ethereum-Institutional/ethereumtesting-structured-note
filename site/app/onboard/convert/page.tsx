import { redirect } from "next/navigation";
import Link from "next/link";
import { currentRegistrant } from "@/lib/access";
import { balances, tokens } from "@/lib/pool/convert";
import { chainParams } from "@/lib/chains";
import { loadManifest } from "@/lib/chain/manifest";
import { conversionDoneAction, prepareConversionAction, quoteAction } from "../../actions";
import { ConvertPanel } from "../ConvertPanel";
import { accountOf, walletOf } from "../account";

export const dynamic = "force-dynamic";

/** Converting in the pool from the client's own wallet (ADR 0070). */
export default async function Convert() {
  const who = await currentRegistrant();
  if (!who) redirect("/");
  const { wallet, held } = await accountOf(who);
  const chain = chainParams(loadManifest().chainId);
  const t = tokens();
  const address = wallet ? walletOf(wallet) : null;
  const have = address ? await balances(address).catch(() => null) : null;
  const show = (v: bigint, decimals: number) => (Number(v) / 10 ** decimals).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: decimals });
  return (
    <>
      <h2 id="convert">Convert</h2>
      {address ? (
        <section className="panel">
          <dl className="facts">
            <dt>{t.payment.symbol}</dt><dd>{have ? show(have.payment, t.payment.decimals) : "–"}</dd>
            <dt>{t.deposit.symbol}</dt><dd>{have ? show(have.deposit, t.deposit.decimals) : "–"}</dd>
            <dt>ETH for fees</dt><dd>{have ? show(have.eth, 18) : "–"}</dd>
          </dl>
          {!have && <p className="muted">The wallet's balances could not be read just now.</p>}
          {chain.chainId === "0x14a34" && (
            <p className="muted">
              Test {t.payment.symbol}: <a href="https://faucet.circle.com" target="_blank" rel="noreferrer">Circle's faucet</a>. Test ETH for fees: <a href="https://docs.base.org/base-chain/tools/network-faucets" target="_blank" rel="noreferrer">Base Sepolia faucets</a>. {t.deposit.symbol} is credited by your bank.
            </p>
          )}
          <ConvertPanel
            wallet={address}
            chain={chain}
            symbols={{ payment: t.payment.symbol, deposit: t.deposit.symbol }}
            assets={[t.payment, t.deposit]}
            quote={quoteAction}
            prepare={prepareConversionAction}
            done={conversionDoneAction}
          />
        </section>
      ) : held ? (
        <section className="panel"><p className="muted" style={{ margin: 0 }}>Your bank holds your account in custody and converts in the pool on your instruction.</p></section>
      ) : (
        <section className="panel"><p className="muted" style={{ margin: 0 }}>Onboard a wallet first, under <Link href="/onboard">Account</Link>.</p></section>
      )}
    </>
  );
}
