/**
 * Plain-English translations of the checker's gate strings, for anything an investor or an
 * audience reads. The raw strings (lib/data.ts firstFailingGate, lib/applications.ts) stay as
 * the compact operator vocabulary; these are the sentences.
 */
export function plainGate(gate: string): string {
  switch (gate) {
    case "wallet frozen":
    case "wallet frozen by agent":
      return "Your wallet has been frozen by the fund's transfer agent";
    case "identity not verified":
      return "Your on-chain identity is not verified yet";
    case "asset paused by issuer":
      return "The issuer has paused this asset — all transfers and trading are halted";
    case "jurisdiction blocked at venue":
      return "Your jurisdiction is currently blocked at this trading venue";
    case "asset not registered at venue":
      return "This asset is not registered at the trading venue";
    default:
      return gate;
  }
}
