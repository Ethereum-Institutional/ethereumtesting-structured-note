"use client";

import { GuideBar, type GuideStep } from "./GuideBar";

/**
 * The console's presenter script. The console is split into one-job pages, so each step names
 * the page it lives on and the GuideBar navigates there as the presenter advances — the demo
 * walks the tabs in order: market → investors → trade → market → investors → trade → controls
 * → ledger → reset.
 */

const STEPS: GuideStep[] = [
  {
    href: "/",
    target: "market",
    title: "Set the scene",
    say: "This is a tokenized fund trading on real Uniswap infrastructure — not a simulation.",
    watch: "Price and pool depth are read from the blockchain every 6 seconds.",
  },
  {
    href: "/investors",
    target: "investors",
    title: "The on-chain passports",
    say: "Every investor holds an on-chain passport — an identity contract with claims signed by the fund's KYC provider. The market checks the passport, not our database.",
    act: "Point at the ON-CHAIN PASSPORT column: the ONCHAINID address and its stamps.",
  },
  {
    href: "/investors",
    target: "investors",
    title: "Open a passport",
    say: "No name, no documents on chain — just claims and the KYC provider's cryptographic seals. The paperwork never leaves the provider.",
    act: "Click a KYC or ACCREDITED stamp. Run all the checks — then change one character and watch the forgery fail.",
    watch: "Every check is one contract call, answered live by the chain — the same calls the pool makes inside every order.",
  },
  {
    href: "/trade",
    target: "trade",
    title: "Place a trade",
    act: "On the investor's window, place a buy — or trade here as Alice.",
    watch: "The receipt shows the mined transaction and the pool price after settlement, read back from the chain.",
  },
  {
    href: "/",
    target: "market",
    title: "It prints on the tape",
    say: "That order settled on a public ledger — there's the transaction hash, and the price moved.",
  },
  {
    href: "/investors",
    target: "investors",
    title: "Freeze the investor",
    act: "Click FREEZE on the investor who just traded.",
    watch: "The receipt: one Solidity call, the mined transaction, and the chain reading back isFrozen → true.",
  },
  {
    href: "/trade",
    target: "trade",
    title: "The market says no",
    act: "Place the exact same order again.",
    say: "No back office stopped this. The pool's compliance hook read their passport and refused — and the rejection prints on the tape too.",
  },
  {
    href: "/controls",
    target: "controls",
    title: "Block a jurisdiction",
    act: "Click JAPAN off — enforcement switches on automatically with it.",
    watch: "One storage slot flips on a public contract, read back from the chain. Every Japan-registered passport is now locked out.",
  },
  {
    href: "/ledger",
    target: "ledger",
    title: "The public ledger",
    say: "Everything we just did is public record, decoded from the chain's own transaction log. There is no application log that could disagree with it.",
  },
  {
    href: "/",
    target: "header",
    title: "Reset for the next audience",
    act: "Unfreeze the investor, re-allow Japan, then press RESET DEMO in the header.",
    watch: "The chain rewinds to the armed baseline — balances, price, freezes and the tape.",
  },
];

export function DemoGuide() {
  return (
    <GuideBar
      steps={STEPS}
      label="Present demo"
      hint="run the investor's screen in a second window beside this one"
    />
  );
}
