import {
  decodeFunctionData,
  formatUnits,
  getAddress,
  keccak256,
  toBytes,
  parseAbiItem,
  toFunctionSelector,
  type AbiFunction,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { addressBook, type Manifest } from "./manifest.ts";

/**
 * The audit tape: what was instructed on-chain, decoded from each transaction's calldata.
 *
 * Three properties matter more than presentation, because an audit tape that is quietly
 * incomplete is the worst failure this audience can meet.
 *
 * - A call is identified by the contract it was sent to and its selector together. Two tokens
 *   share `mint`, `transfer` and `approve`; keyed by name alone they are indistinguishable.
 * - Nothing is dropped. A call the registry does not know becomes a row marked unrecognised,
 *   with its selector and full calldata, so a gap in the registry is visible on the tape.
 * - Arguments are rendered from what the registry says they are. An amount is formatted with
 *   the decimals of the token it is denominated in, never guessed from its size, and text is
 *   shown whole, so a written intervention reason is never cut off.
 *
 * Calls made through a custody account are unwrapped, one row per inner call, so the row shows
 * the instruction the Custodian gave rather than the envelope it travelled in.
 */

export type Tone = "control" | "trade" | "onboard" | "ops" | "unrecognised";

/**
 * How an argument is shown. `amount` is in units of the called token; `amountOf` is in units of
 * the token passed at that argument index.
 */
export type ArgSpec =
  | "account"
  | "amount"
  | { amountOf: number }
  | "flag"
  | "number"
  | "text"
  | "reason"
  | "plan"
  | "poolKey"
  | "time"
  | "ref"
  | "role"
  | "levels"
  | "outcome"
  | "signature"
  | "kind"
  | "accounts"
  | { amountIn: string }
  | "calls"
  | "items"
  | "restrictions"
  | "topics"
  | "claimData"
  | "issuance"
  | "correction";

export type Entry = { signature: string; meaning: string; tone: Tone; args: ArgSpec[] };

/** Role administration, on every contract that uses role-based access control. */
const ROLES: Entry[] = [
  { signature: "function grantRole(bytes32 role, address account)", meaning: "Granted a role", tone: "control", args: ["role", "account"] },
  { signature: "function revokeRole(bytes32 role, address account)", meaning: "Revoked a role", tone: "control", args: ["role", "account"] },
  { signature: "function renounceRole(bytes32 role, address account)", meaning: "Renounced a role", tone: "control", args: ["role", "account"] },
];

/** An ERC-20's own calls, on the note and the deposit alike. */
const ERC20: Entry[] = [
  { signature: "function transfer(address to, uint256 value)", meaning: "Transferred units", tone: "trade", args: ["account", "amount"] },
  { signature: "function transferFrom(address from, address to, uint256 value)", meaning: "Transferred units under an allowance", tone: "trade", args: ["account", "account", "amount"] },
  { signature: "function approve(address spender, uint256 value)", meaning: "Set an allowance", tone: "ops", args: ["account", "amount"] },
];

/** Two-step ownership: T-REX's contracts, the venue's checker and the permissions adapter. */
const OWNABLE: Entry[] = [
  { signature: "function transferOwnership(address newOwner)", meaning: "Offered ownership to a new owner, pending acceptance", tone: "control", args: ["account"] },
  { signature: "function acceptOwnership()", meaning: "Accepted ownership", tone: "control", args: [] },
];

/** T-REX's agents, on its token and its identity registries. */
const AGENTS: Entry[] = [
  { signature: "function addAgent(address agent)", meaning: "Made an account an agent", tone: "control", args: ["account"] },
  { signature: "function removeAgent(address agent)", meaning: "Removed an agent", tone: "control", args: ["account"] },
];

/** The note: an ERC-3643 token (T-REX), whose agents act within their restrictions. */
const NOTE_TOKEN: Entry[] = [
  ...ERC20,
  ...OWNABLE,
  ...AGENTS,
  { signature: "function mint(address to, uint256 amount)", meaning: "Issued units", tone: "onboard", args: ["account", "amount"] },
  { signature: "function burn(address from, uint256 amount)", meaning: "Burned units", tone: "control", args: ["account", "amount"] },
  { signature: "function pause()", meaning: "Paused the note: all transfers halted", tone: "control", args: [] },
  { signature: "function unpause()", meaning: "Unpaused the note", tone: "control", args: [] },
  { signature: "function setAddressFrozen(address user, bool freeze)", meaning: "Froze or unfroze an account", tone: "control", args: ["account", "flag"] },
  { signature: "function freezePartialTokens(address user, uint256 amount)", meaning: "Locked part of a holding", tone: "trade", args: ["account", "amount"] },
  { signature: "function unfreezePartialTokens(address user, uint256 amount)", meaning: "Unlocked part of a holding", tone: "trade", args: ["account", "amount"] },
  { signature: "function forcedTransfer(address from, address to, uint256 amount)", meaning: "Forced a transfer without the holder's signature", tone: "control", args: ["account", "account", "amount"] },
  { signature: "function recoveryAddress(address lostWallet, address newWallet, address investorOnchainId)", meaning: "Recovered a lost wallet's units to its new wallet", tone: "control", args: ["account", "account", "account"] },
  { signature: "function setAgentRestrictions(address agent, (bool disableMint, bool disableBurn, bool disablePartialFreeze, bool disableAddressFreeze, bool disableRecovery, bool disableForceTransfer, bool disablePause) restrictions)", meaning: "Limited an agent to the powers named", tone: "control", args: ["account", "restrictions"] },
];

/** The tokenized deposit. */
const DEPOSIT_TOKEN: Entry[] = [
  ...ROLES,
  ...ERC20,
  { signature: "function mint(address account, uint256 amount)", meaning: "Created deposit", tone: "onboard", args: ["account", "amount"] },
  { signature: "function burn(address account, uint256 amount)", meaning: "Extinguished deposit", tone: "onboard", args: ["account", "amount"] },
  { signature: "function pause()", meaning: "Paused the deposit: all transfers halted", tone: "control", args: [] },
  { signature: "function unpause()", meaning: "Unpaused the deposit", tone: "control", args: [] },
  { signature: "function setAllowlisted(address account, bool allowed)", meaning: "Allowlisted a contract to hold and move the deposit, or removed it", tone: "onboard", args: ["account", "flag"] },
  { signature: "function setAllowlistedMany(address[] accounts, bool allowed)", meaning: "Allowlisted several accounts for the deposit, or removed them, in one call", tone: "onboard", args: ["accounts", "flag"] },
  { signature: "function setFrozenTokens(address account, uint256 amount)", meaning: "Set the frozen part of a holding", tone: "control", args: ["account", "amount"] },
  { signature: "function enforce(address from, address to, uint256 amount, string reason)", meaning: "The bank moved its deposit by order, with its written reason", tone: "control", args: ["account", "account", "amount", "text"] },
  { signature: "function forcedTransfer(address from, address to, uint256 amount)", meaning: "Forced a transfer without the holder's signature", tone: "control", args: ["account", "account", "amount"] },
  { signature: "function setIdentityRegistry(address registry)", meaning: "Pointed the deposit at a new identity registry", tone: "control", args: ["account"] },
];

/** An ONCHAINID identity: keys, and the claims institutions add to it. */
const IDENTITY: Entry[] = [
  { signature: "function addKey(bytes32 key, uint256 purpose, uint256 keyType)", meaning: "Added a key to an identity: management (1) or claim (3), the latter the client's consent to an institution vouching for it", tone: "onboard", args: ["ref", "number", "number"] },
  { signature: "function removeKey(bytes32 key, uint256 purpose)", meaning: "Removed a key from an identity", tone: "onboard", args: ["ref", "number"] },
  { signature: "function addClaim(uint256 topic, uint256 scheme, address issuer, bytes signature, bytes data, string uri)", meaning: "An institution vouched for an identity: a claim it signed", tone: "onboard", args: ["topics", "number", "account", "signature", "claimData", "text"] },
  { signature: "function removeClaim(bytes32 claimId)", meaning: "Removed a claim from an identity", tone: "control", args: ["ref"] },
];

/** Contract kinds, each with the calls the tape knows for it. */
export const REGISTRY: Record<string, Entry[]> = {
  paymentToken: [
    { signature: "function mint(address to, uint256 amount)", meaning: "Issued the payment token (local stand-in only)", tone: "ops", args: ["account", "amount"] },
    { signature: "function transfer(address to, uint256 amount)", meaning: "Transferred the payment token", tone: "trade", args: ["account", "amount"] },
    { signature: "function approve(address spender, uint256 amount)", meaning: "Set an allowance on the payment token", tone: "ops", args: ["account", "amount"] },
  ],
  checker: [
    { signature: "function registerAsset(address token)", meaning: "Registered an asset with the checker", tone: "ops", args: ["account"] },
    { signature: "function unregisterAsset(address token)", meaning: "Removed an asset from the checker", tone: "control", args: ["account"] },
    { signature: "function setLiquidityRestricted(address token, bool restricted)", meaning: "Set whether providing liquidity needs venue approval", tone: "control", args: ["account", "flag"] },
    { signature: "function setLiquidityApproved(address token, address account, bool approved)", meaning: "Set an account's approval to provide liquidity", tone: "control", args: ["account", "account", "flag"] },
    { signature: "function setCredentialGate(address token, address gate)", meaning: "Set the gate an account must also pass for this asset", tone: "control", args: ["account", "account"] },
    ...OWNABLE,
  ],
  credentialGate: [
    ...ROLES,
    { signature: "function withdraw(address account, string reason)", meaning: "Withdrew an account from the pool under supervisory authority, with a written reason", tone: "control", args: ["account", "text"] },
    { signature: "function restore(address account, string reason)", meaning: "Lifted a supervisory withdrawal from the pool, with a written reason", tone: "control", args: ["account", "text"] },
  ],
  adapter: [
    { signature: "function updateAllowedWrapper(address wrapper, bool allowed)", meaning: "Allowed or refused a wrapper (router or position manager) on the adapter", tone: "control", args: ["account", "flag"] },
    { signature: "function updateAllowedHook(address hook, bool allowed)", meaning: "Allowed or refused a hook on the adapter", tone: "control", args: ["account", "flag"] },
    { signature: "function updateSwappingEnabled(bool enabled)", meaning: "Switched trading of the asset on or off", tone: "control", args: ["flag"] },
    { signature: "function updateAllowListChecker(address checker)", meaning: "Replaced the adapter's checker", tone: "control", args: ["account"] },
    { signature: "function depositForVerification(uint256 amount)", meaning: "Placed a balance in the adapter for verification", tone: "ops", args: ["number"] },
    ...OWNABLE,
  ],
  adapterFactory: [
    { signature: "function createPermissionsAdapter(address token, address owner, address checker)", meaning: "Wrapped an asset in a permissions adapter", tone: "ops", args: ["account", "account", "account"] },
    { signature: "function verifyPermissionsAdapter(address adapter)", meaning: "Verified a permissions adapter", tone: "ops", args: ["account"] },
  ],
  poolManager: [
    { signature: "function initialize((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, uint160 sqrtPriceX96)", meaning: "Opened a pool", tone: "control", args: ["poolKey", "number"] },
  ],
  router: [
    { signature: "function execute(bytes unlockData, uint256 deadline)", meaning: "Swapped through the permissioned router", tone: "trade", args: ["plan", "number"] },
  ],
  positionManager: [
    { signature: "function modifyLiquidities(bytes unlockData, uint256 deadline)", meaning: "Changed a liquidity position", tone: "trade", args: ["plan", "number"] },
  ],
  // Public infrastructure a client's own wallet may use (PUBLIC_INFRASTRUCTURE): named, never watched.
  delegationManager: [
    {
      signature: "function redeemDelegations(bytes[] permissionContexts, bytes32[] modes, bytes[] executionCallDatas)",
      meaning: "A MetaMask smart account's call, relayed through MetaMask's delegation framework; its effect is the event on the contract it reached",
      tone: "ops",
      args: ["items", "items", "items"],
    },
  ],
  permit2: [
    { signature: "function approve(address token, address spender, uint160 amount, uint48 expiration)", meaning: "Set a Permit2 allowance", tone: "ops", args: ["account", "account", { amountOf: 0 }, "number"] },
  ],
  note: NOTE_TOKEN,
  deposit: DEPOSIT_TOKEN,
  identity: IDENTITY,
  identityRegistry: [
    ...OWNABLE,
    ...AGENTS,
    { signature: "function registerIdentity(address userAddress, address identity, uint16 country)", meaning: "Registered a wallet against its identity", tone: "onboard", args: ["account", "account", "number"] },
    { signature: "function deleteIdentity(address userAddress)", meaning: "Removed a wallet from the identity storage", tone: "control", args: ["account"] },
    { signature: "function updateIdentity(address userAddress, address identity)", meaning: "Moved a wallet to another identity", tone: "control", args: ["account", "account"] },
    { signature: "function updateCountry(address userAddress, uint16 country)", meaning: "Changed a wallet's country", tone: "onboard", args: ["account", "number"] },
    { signature: "function setIdentityRegistryStorage(address identityStorage)", meaning: "Pointed the registry at its identity storage", tone: "ops", args: ["account"] },
  ],
  trustedIssuers: [
    ...OWNABLE,
    { signature: "function addTrustedIssuer(address trustedIssuer, uint256[] claimTopics)", meaning: "Trusted a claim issuer for the topics named", tone: "control", args: ["account", "topics"] },
    { signature: "function removeTrustedIssuer(address trustedIssuer)", meaning: "Ceased to trust a claim issuer", tone: "control", args: ["account"] },
    { signature: "function updateIssuerClaimTopics(address trustedIssuer, uint256[] claimTopics)", meaning: "Changed the topics a claim issuer is trusted for", tone: "control", args: ["account", "topics"] },
  ],
  claimTopics: [
    ...OWNABLE,
    { signature: "function addClaimTopic(uint256 claimTopic)", meaning: "Required a claim topic", tone: "control", args: ["topics"] },
    { signature: "function removeClaimTopic(uint256 claimTopic)", meaning: "Ceased to require a claim topic", tone: "control", args: ["topics"] },
  ],
  claimIssuer: [
    { signature: "function revokeClaimBySignature(bytes signature)", meaning: "The institution revoked a claim it made", tone: "control", args: ["signature"] },
    { signature: "function revokeClaim(bytes32 claimId, address identity)", meaning: "The institution revoked a claim it made", tone: "control", args: ["ref", "account"] },
    { signature: "function setMaxValidity(uint48 maxValidity)", meaning: "Set the longest a claim may run, in seconds", tone: "control", args: ["number"] },
    { signature: "function addKey(bytes32 key, uint256 purpose, uint256 keyType)", meaning: "Added a key to the claim issuer", tone: "control", args: ["ref", "number", "number"] },
    { signature: "function removeKey(bytes32 key, uint256 purpose)", meaning: "Removed a key from the claim issuer", tone: "control", args: ["ref", "number"] },
  ],
  compliance: [
    ...OWNABLE,
    { signature: "function addModule(address module)", meaning: "Added a compliance module", tone: "control", args: ["account"] },
    { signature: "function removeModule(address module)", meaning: "Removed a compliance module", tone: "control", args: ["account"] },
  ],
  idFactory: [
    { signature: "function transferOwnership(address newOwner)", meaning: "Handed the identity factory to a new owner", tone: "control", args: ["account"] },
    { signature: "function addTokenFactory(address factory)", meaning: "Let a token factory create its tokens' identities", tone: "ops", args: ["account"] },
    { signature: "function createIdentityWithManagementKeys(address wallet, string salt, bytes32[] managementKeys)", meaning: "The bank created a client's identity, managed by the keys named", tone: "onboard", args: ["account", "text", "items"] },
    { signature: "function createIdentity(address wallet, string salt)", meaning: "Created an identity, managed by its wallet", tone: "onboard", args: ["account", "text"] },
  ],
  trexFactory: [
    { signature: "function transferOwnership(address newOwner)", meaning: "Handed T-REX's factory to a new owner: the note factory", tone: "control", args: ["account"] },
    { signature: "function deployTREXSuite(string salt, (address owner, string name, string symbol, uint8 decimals, address irs, address ONCHAINID, address[] irAgents, address[] tokenAgents, address[] complianceModules, bytes[] complianceSettings) tokenDetails, (uint256[] claimTopics, address[] issuers, uint256[][] issuerClaims) claimDetails)", meaning: "Issued a note's T-REX suite: token, identity registry, compliance", tone: "control", args: ["text", "plan", "plan"] },
  ],
  noteFactory: [
    { signature: `function issue((string isin, string name, string symbol, (uint256[] initialLevels, uint64 calculationAmountCents, uint32 couponBarrierBps, uint32 couponRateBps, bool memory_, uint32 barrierBps, (bool applies, uint32 upBps, uint32 downBps, uint32 capBps) twinWin, (uint48 date, uint48 recordTime, uint48 paymentDate, bool coupon, bool mer, bool barrier, bool isFinal, uint32 merTriggerBps)[] schedule) terms, address issuer, bytes32 termSheetHash, string termSheetUri, uint256 units, bool open, uint256[] extraTopics, address[] extraIssuers) p)`, meaning: "Issued a note whole, in one transaction: terms, T-REX suite, term sheet, Paying Agent, settlement, notional, handed to the controller", tone: "control", args: ["issuance"] },
    { signature: `function issueMany((string isin, string name, string symbol, (uint256[] initialLevels, uint64 calculationAmountCents, uint32 couponBarrierBps, uint32 couponRateBps, bool memory_, uint32 barrierBps, (bool applies, uint32 upBps, uint32 downBps, uint32 capBps) twinWin, (uint48 date, uint48 recordTime, uint48 paymentDate, bool coupon, bool mer, bool barrier, bool isFinal, uint32 merTriggerBps)[] schedule) terms, address issuer, bytes32 termSheetHash, string termSheetUri, uint256 units, bool open, uint256[] extraTopics, address[] extraIssuers)[] ps)`, meaning: "Issued several notes in one transaction, each a series of its own", tone: "control", args: ["items"] },
    { signature: "function retire(address token)", meaning: "Retired a redeemed note and released its identity registry", tone: "control", args: ["account"] },
    { signature: "function releaseTrexFactory(address successor)", meaning: "Handed the T-REX factory to a successor", tone: "control", args: ["account"] },
    ...OWNABLE,
  ],
  recordDates: [
    { signature: "function sync(address[] accounts)", meaning: "Recorded balances after a wallet recovery", tone: "ops", args: ["accounts"] },
  ],
  gateway: [
    ...ROLES,
    { signature: "function credit(address account, uint256 amount, bytes32 bookingRef)", meaning: "Created deposit on credit to an account", tone: "onboard", args: ["account", { amountIn: "deposit" }, "ref"] },
    { signature: "function debit(address account, uint256 amount, bytes32 bookingRef)", meaning: "Extinguished deposit on debit from an account", tone: "onboard", args: ["account", { amountIn: "deposit" }, "ref"] },
  ],
  determinations: [
    { signature: "function correct(uint256 dateIndex, uint256[] levels, (bool breached, bool couponPaid, uint64 couponPerCa, bool redeemed, uint64 redemptionPerCa, uint8 worstIndex) claimed, bytes signature)", meaning: "Corrected the latest determination, as the Calculation Agent signed it again", tone: "control", args: ["number", "levels", "outcome", "signature"] },
    { signature: "function determine(uint256 dateIndex, uint256[] levels, (bool breached, bool couponPaid, uint64 couponPerCa, bool redeemed, uint64 redemptionPerCa, uint8 worstIndex) claimed, bytes signature)", meaning: "Accepted the Calculation Agent's determination: two computations agreed", tone: "control", args: ["number", "levels", "outcome", "signature"] },
  ],
  payingAgent: [
    ...ROLES,
    { signature: "function open(uint256 dateIndex, uint8 kind)", meaning: "Opened a distribution and debited its cash from the Agent", tone: "trade", args: ["number", "kind"] },
    { signature: "function pay(bytes32 id, address[] holders)", meaning: "Paid holders of record at the Record Time", tone: "trade", args: ["ref", "accounts"] },
    { signature: "function claim(bytes32 id, address holder)", meaning: "Paid an amount held for a holder the deposit could not credit", tone: "trade", args: ["ref", "account"] },
    { signature: "function reverse(bytes32 id, address[] holders, string reason)", meaning: "Reversed a distribution, holder by holder, with a written reason", tone: "control", args: ["ref", "accounts", "text"] },
    { signature: "function restate(bytes32 original, uint48 recordTime, string reason)", meaning: "Restated a reversed distribution against a corrected Record Time", tone: "control", args: ["ref", "time", "text"] },
  ],
  settlement: [
    { signature: "function propose(address seller, address buyer, uint64 units, uint256 price, uint48 deadline)", meaning: "Proposed a delivery-versus-payment trade", tone: "trade", args: ["account", "account", { amountIn: "note" }, { amountIn: "deposit" }, "time"] },
    { signature: "function accept(uint256 id)", meaning: "Accepted a trade: both legs settled together", tone: "trade", args: ["number"] },
    { signature: "function cancel(uint256 id)", meaning: "Cancelled a proposed trade", tone: "ops", args: ["number"] },
    // The locked settlement of notes issued from on: accept and cancel are the same calls.
    { signature: "function offer(uint8 side, address counterparty, uint64 units, uint256 price, uint48 deadline)", meaning: "Offered to sell or to buy units, its side locked until it settles or ends", tone: "trade", args: ["number", "account", { amountIn: "note" }, { amountIn: "deposit" }, "time"] },
    { signature: "function release(uint256 id)", meaning: "Released an offer's lock, past its deadline or with the note paused", tone: "ops", args: ["number"] },
  ],
  controller: [
    { signature: "function bindFactory(address f)", meaning: "Bound the note factory whose notes the controller governs, once", tone: "control", args: ["account"] },
    { signature: "function correctRegister(address token, address from, address to, uint256 units, string reason)", meaning: "Tier 1: corrected a note's register to match the Register", tone: "control", args: ["account", "account", "account", { amountOf: 0 }, "text"] },
    { signature: "function freezeAccount(address[] tokens, address account, bool frozen, string reason)", meaning: "Tier 1: froze or unfroze an account on the notes named, whichever institution vouched for it", tone: "control", args: ["accounts", "account", "flag", "text"] },
    { signature: "function recoverWallet(address[] tokens, address lostWallet, address newWallet, address identity, string reason)", meaning: "Tier 1: recovered a lost wallet's units of every note named to its new wallet", tone: "control", args: ["accounts", "account", "account", "account", "text"] },
    { signature: "function designate(address account, bool on, string reason)", meaning: "Tier 1: designated an account under the programme's sanctions, or lifted it, on every note", tone: "control", args: ["account", "flag", "text"] },
    { signature: "function cancelInventory(address token, uint256 units, string reason)", meaning: "Tier 1: cancelled units from the Issuer's inventory of a note", tone: "control", args: ["account", { amountOf: 0 }, "text"] },
    { signature: "function setNotePaused(address token, bool paused)", meaning: "Servicing: paused or unpaused a note's transfers", tone: "control", args: ["account", "flag"] },
    { signature: "function acceptOwnerships(address[] owned)", meaning: "Accepted ownership of the venue's contracts", tone: "control", args: ["accounts"] },
    { signature: "function proposeAmendNotional(address token, bool increase, uint256 units, string reason)", meaning: "Tier 2 proposal: amend the notional in the Issuer's inventory of a note", tone: "control", args: ["account", "flag", { amountOf: 0 }, "text"] },
    { signature: "function proposeReverseDistribution(address token, bytes32 distribution, address[] holders, string reason)", meaning: "Tier 2 proposal: reverse a distribution", tone: "control", args: ["account", "ref", "accounts", "text"] },
    { signature: "function proposeRestateDistribution(address token, bytes32 original, uint48 recordTime, string reason)", meaning: "Tier 2 proposal: restate a distribution", tone: "control", args: ["account", "ref", "time", "text"] },
    { signature: "function proposeCorrectDetermination((address token, uint256 dateIndex, uint256[] levels, (bool breached, bool couponPaid, uint64 couponPerCa, bool redeemed, uint64 redemptionPerCa, uint8 worstIndex) outcome, bytes signature, address[] holders) c, string reason)", meaning: "Tier 2 proposal: correct a note's latest determination, reversing and restating its coupon where paid", tone: "control", args: ["correction", "text"] },
    { signature: "function proposeSetTrustedIssuer(address token, address issuer, uint256[] topics, string reason)", meaning: "Tier 2 proposal: trust a claim issuer for a note, or cease to", tone: "control", args: ["account", "account", "topics", "text"] },
    { signature: "function proposeReplaceRole(uint8 role, address newHolder, string reason)", meaning: "Tier 2 proposal: replace the servicing wallet, the Calculation Agent or the funder, for every note", tone: "control", args: ["number", "account", "text"] },
    { signature: "function proposeReplaceInstitution(address oldWallet, address newWallet, string reason)", meaning: "Recovery proposal: replace an institution's wallet", tone: "control", args: ["account", "account", "text"] },
    { signature: "function proposeSetDepositRole(address target, bytes32 role, address account, bool grant, string reason)", meaning: "Tier 2 proposal: grant or revoke a role on the deposit", tone: "control", args: ["account", "role", "account", "flag", "text"] },
    { signature: "function proposeRetireNote(address token, string reason)", meaning: "Tier 2 proposal: retire a redeemed note", tone: "control", args: ["account", "text"] },
    { signature: "function proposeReleaseFactory(address successor, string reason)", meaning: "Tier 2 proposal: hand the T-REX factory to a successor", tone: "control", args: ["account", "text"] },
    { signature: "function withdrawPoolAccess(address account, string reason)", meaning: "Tier 1: withdrew an account's pool access under supervisory authority", tone: "control", args: ["account", "text"] },
    { signature: "function restorePoolAccess(address account, string reason)", meaning: "Tier 1: restored an account's pool access", tone: "control", args: ["account", "text"] },
    { signature: "function setVenueSwapping(bool enabled)", meaning: "Servicing: switched swapping in the conversion pool on or off", tone: "control", args: ["flag"] },
    { signature: "function proposeSetCredentialGate(address gate, string reason)", meaning: "Tier 2 proposal: point the pool at a new gate", tone: "control", args: ["account", "text"] },
    { signature: "function proposeSetLiquidityProvider(address account, bool approved, string reason)", meaning: "Tier 2 proposal: approve or remove a liquidity provider", tone: "control", args: ["account", "flag", "text"] },
    { signature: "function proposeSetVenueWrapper(address wrapper, bool allowed, string reason)", meaning: "Tier 2 proposal: allow or refuse a router or position manager on the adapter", tone: "control", args: ["account", "flag", "text"] },
    { signature: "function proposeSetVenueHook(address hook, bool allowed, string reason)", meaning: "Tier 2 proposal: allow or refuse a hook on the adapter", tone: "control", args: ["account", "flag", "text"] },
    { signature: "function proposeSetPoolIssuer(address issuer, bool trusted, string reason)", meaning: "Tier 2 proposal: trust a claim issuer to vouch for pool access, or cease to", tone: "control", args: ["account", "flag", "text"] },
    { signature: "function approve(uint256 id)", meaning: "Approved a Tier 2 proposal", tone: "control", args: ["number"] },
    { signature: "function execute(uint256 id)", meaning: "Executed a Tier 2 proposal after its delay", tone: "control", args: ["number"] },
    { signature: "function cancel(uint256 id)", meaning: "Cancelled a Tier 2 proposal", tone: "control", args: ["number"] },
  ],
  sanctions: [
    { signature: "function bindGovernance(address g)", meaning: "Bound the governance controller that designates accounts, once", tone: "control", args: ["account"] },
    { signature: "function designate(address account, bool on)", meaning: "Designated an account under the programme's sanctions, or lifted it", tone: "control", args: ["account", "flag"] },
  ],
  wallet: [
    { signature: "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures)", meaning: "A multi-signature wallet acted", tone: "control", args: ["account", "number", "plan", "number", "number", "number", "number", "account", "account", "signature"] },
  ],
  walletFactory: [
    { signature: "function createProxyWithNonce(address singleton, bytes initializer, uint256 saltNonce)", meaning: "Created a multi-signature wallet", tone: "ops", args: ["account", "plan", "number"] },
  ],
  custodyFactory: [
    { signature: "function createAccount(string clientRef)", meaning: "Opened a segregated client account", tone: "onboard", args: ["text"] },
  ],
  custodyAccount: [
    { signature: "function executeOne(address target, uint256 value, bytes data)", meaning: "Custodian acted for a client account", tone: "trade", args: ["account", "number", "plan"] },
    { signature: "function execute((address target, uint256 value, bytes data)[] calls)", meaning: "Custodian acted for a client account", tone: "trade", args: ["calls"] },
  ],
};

/** Which registry kind each manifest key is. Assets not listed here are unrecognised. */
const KIND_OF_KEY: Record<string, string> = {
  "assets.paymentToken": "paymentToken",
  "venue.allowlistChecker": "checker",
  "venue.credentialGate": "credentialGate",
  "venue.permissionsAdapter": "adapter",
  "venue.adapterFactory": "adapterFactory",
  "venue.router": "router",
  "venue.positionManager": "positionManager",
  "venue.permit2": "permit2",
  "venue.poolManager": "poolManager",
  "custody.factory": "custodyFactory",
  "assets.note": "note",
  "assets.deposit": "deposit",
  "instruments.gateway": "gateway",
  "identity.idFactory": "idFactory",
  "identity.trexFactory": "trexFactory",
  "identity.noteFactory": "noteFactory",
  "identity.bankIssuer": "claimIssuer",
  "identity.onboardingIssuer": "claimIssuer",
  "identity.depositRegistry": "identityRegistry",
  "noteSuite.identityRegistry": "identityRegistry",
  "noteSuite.trustedIssuers": "trustedIssuers",
  "noteSuite.claimTopics": "claimTopics",
  "noteSuite.compliance": "compliance",
  "identity.depositTopics": "claimTopics",
  "identity.depositIssuers": "trustedIssuers",
  "identity.poolRegistry": "identityRegistry",
  "identity.poolTopics": "claimTopics",
  "identity.poolIssuers": "trustedIssuers",
  "lifecycle.recordDates": "recordDates",
  "lifecycle.determinations": "determinations",
  "lifecycle.payingAgent": "payingAgent",
  "lifecycle.settlement": "settlement",
  "governance.controller": "controller",
  "governance.walletFactory": "walletFactory",
  "governance.agentGovernance": "wallet",
  "governance.issuerGovernance": "wallet",
  "governance.cosigner": "wallet",
  "governance.servicingWallet": "wallet",
  "programme.sanctions": "sanctions",
};

/**
 * Contracts outside the deployment that clients' own wallets route through, at their canonical
 * addresses. Named and decoded, but never watched: on a public network they carry everyone's traffic.
 */
const PUBLIC_INFRASTRUCTURE: Record<string, { key: string; label: string }> = {
  "0xdb9b1e94b5b69df7e401ddbede43491141047db3": { key: "public.delegationManager", label: "MetaMask delegation manager" },
};
KIND_OF_KEY["public.delegationManager"] = "delegationManager";

/** The contracts of a note issued from the site: `notes.<symbol>.<part>`, decoded as the live note's are. */
const NOTE_PARTS: Record<string, string> = { note: "note", determinations: "determinations", recordDates: "recordDates", identityRegistry: "identityRegistry", payingAgent: "payingAgent", settlement: "settlement", noteIdentity: "identity" };

function kindOfKey(key: string): string | undefined {
  if (key.startsWith("custody.accounts.") || (key.startsWith("custody.thirdParty.") && key !== "custody.thirdParty.factory")) return "custodyAccount";
  if (key === "custody.thirdParty.factory") return "custodyFactory";
  if (key.startsWith("identities.")) return "identity";
  if (key.startsWith("notes.")) return NOTE_PARTS[key.split(".").at(-1) ?? ""];
  return KIND_OF_KEY[key];
}

/** The maximum of each allowance width in use: an allowance without limit, not an amount. */
const UNLIMITED = new Set([(1n << 256n) - 1n, (1n << 160n) - 1n]);

type Compiled = { entry: Entry; item: AbiFunction };

function compile(registry: Record<string, Entry[]>): Map<string, Compiled> {
  const out = new Map<string, Compiled>();
  for (const [kind, entries] of Object.entries(registry)) {
    for (const entry of entries) {
      const item = parseAbiItem(entry.signature) as AbiFunction;
      if (item.inputs.length !== entry.args.length) {
        throw new Error(`tape registry: ${kind} ${entry.signature} declares ${entry.args.length} argument kinds`);
      }
      const id = `${kind}:${toFunctionSelector(item)}`;
      if (out.has(id)) throw new Error(`tape registry: ${id} is registered twice`);
      out.set(id, { entry, item });
    }
  }
  return out;
}

export type Call = { to: Address; input: Hex };

export type TapeRow = {
  txHash: Hex;
  block: number;
  from: string;
  target: string;
  targetAddress: Address;
  /** The function name, or the selector when unrecognised. */
  fn: string;
  args: string[];
  meaning: string;
  tone: Tone;
  recognised: boolean;
  /** The custody account a call was made through. */
  via?: string;
};

export class Tape {
  private readonly manifest: Manifest;
  private readonly book: ReturnType<typeof addressBook>;
  private readonly compiled: Map<string, Compiled>;

  constructor(manifest: Manifest, registry: Record<string, Entry[]> = REGISTRY, extra: Array<{ address: string; key: string; label: string }> = []) {
    this.manifest = manifest;
    this.book = addressBook(manifest);
    for (const e of extra) this.book.set(e.address.toLowerCase(), { key: e.key, label: e.label });
    for (const [address, entry] of Object.entries(PUBLIC_INFRASTRUCTURE)) if (!this.book.has(address)) this.book.set(address, entry);
    this.compiled = compile(registry);
  }

  /** A deployment. Shown, like everything else, rather than skipped. */
  describeCreation(tx: { hash: Hex; block: number; from: Address }, created?: Address): TapeRow {
    return {
      txHash: tx.hash,
      block: tx.block,
      from: this.label(tx.from),
      target: created ? this.label(created) : "new contract",
      targetAddress: created ? getAddress(created) : "0x0000000000000000000000000000000000000000",
      fn: "(deployment)",
      args: [],
      meaning: "Deployed a contract",
      tone: "ops",
      recognised: true,
    };
  }

  /** Rows for one transaction. Always at least one. */
  describe(tx: { hash: Hex; block: number; from: Address; to: Address; input: Hex }): TapeRow[] {
    const base = { txHash: tx.hash, block: tx.block, from: this.label(tx.from) };
    const outer = this.decode({ to: tx.to, input: tx.input });
    if (outer.compiled && outer.kind === "wallet") {
      // A wallet transaction is shown as the act it carried, signed by the wallet.
      const [to, , data] = outer.args as [Address, bigint, Hex];
      const inner = { to, input: data };
      return [{ ...base, ...this.row(inner, this.decode(inner)), via: this.label(tx.to) }];
    }
    if (!outer.compiled || outer.kind !== "custodyAccount") return [{ ...base, ...this.row({ to: tx.to, input: tx.input }, outer) }];

    // Unwrap the envelope into the calls it carried.
    const via = this.label(tx.to);
    const args = outer.args!;
    const inner: Call[] =
      outer.compiled.item.name === "executeOne"
        ? [{ to: args[0] as Address, input: args[2] as Hex }]
        : (args[0] as Array<{ target: Address; data: Hex }>).map((c) => ({ to: c.target, input: c.data }));
    return inner.map((c) => ({ ...base, ...this.row(c, this.decode(c)), via }));
  }

  private decode(call: Call): { kind?: string; compiled?: Compiled; args?: readonly unknown[] } {
    const kind = this.kindOf(call.to);
    if (!kind || call.input.length < 10) return { kind };
    const compiled = this.compiled.get(`${kind}:${call.input.slice(0, 10).toLowerCase()}`);
    if (!compiled) return { kind };
    try {
      const { args } = decodeFunctionData({ abi: [compiled.item], data: call.input });
      return { kind, compiled, args: args ?? [] };
    } catch {
      return { kind };
    }
  }

  private row(call: Call, d: ReturnType<Tape["decode"]>): Omit<TapeRow, "txHash" | "block" | "from"> {
    const target = { target: this.label(call.to), targetAddress: getAddress(call.to) };
    if (!d.compiled) {
      return {
        ...target,
        fn: call.input.slice(0, 10),
        args: [call.input],
        meaning: d.kind
          ? `Unrecognised call to a known contract: the tape's registry has no entry for this selector on ${d.kind}`
          : "Unrecognised call to a contract the manifest does not name",
        tone: "unrecognised",
        recognised: false,
      };
    }
    const { entry, item } = d.compiled;
    const args = d.args!;
    return {
      ...target,
      fn: item.name,
      args: entry.args.map((spec, i) => this.render(spec, args[i], call.to, args)),
      meaning: entry.meaning,
      tone: entry.tone,
      recognised: true,
    };
  }

  private render(spec: ArgSpec, value: unknown, target: Address, all: readonly unknown[]): string {
    if (spec === "account") return this.label(value as Address);
    if (spec === "amount") return this.amount(value as bigint, target);
    if (typeof spec === "object" && "amountOf" in spec) return this.amount(value as bigint, all[spec.amountOf] as Address);
    if (typeof spec === "object") {
      const t = this.manifest.assets[spec.amountIn];
      return t ? this.amount(value as bigint, t.address) : `${(value as bigint).toString()} base units`;
    }
    if (spec === "restrictions") return restrictions(value as Record<string, boolean>);
    if (spec === "topics") return (Array.isArray(value) ? (value as bigint[]) : [value as bigint]).map(topicName).join(", ") || "none";
    if (spec === "claimData") return claimData(value as Hex);
    if (spec === "issuance") return this.issuance(value as Issuance);
    if (spec === "correction") {
      const c = value as { token: Address; dateIndex: bigint; levels: bigint[]; outcome: Record<string, unknown>; holders: Address[] };
      return `${this.label(c.token)}, date ${Number(c.dateIndex) + 1}, Levels [${c.levels.map(String).join(", ")}]: ${outcome(c.outcome)}${c.holders.length ? `; reverses ${c.holders.length} holder${c.holders.length === 1 ? "" : "s"}` : ""}`;
    }
    if (spec === "levels") return `[${(value as bigint[]).map(String).join(", ")}]`;
    if (spec === "outcome") return outcome(value as Record<string, unknown>);
    if (spec === "signature") return `«signature, ${((value as Hex).length - 2) / 2} bytes»`;
    if (spec === "kind") return Number(value) === 0 ? "coupon" : "redemption";
    if (spec === "accounts") return `[${(value as Address[]).map((x) => this.label(x)).join(", ")}]`;
    if (spec === "time") return new Date(Number(value) * 1000).toISOString();
    if (spec === "ref") return ref(value as Hex);
    if (spec === "role") return ROLE_NAMES.get((value as string).toLowerCase()) ?? (value as string);
    if (spec === "flag") return value ? "true" : "false";
    if (spec === "number") return (value as bigint | number).toString();
    if (spec === "text") return JSON.stringify(value as string);
    if (spec === "reason") return reason(value as Hex);
    if (spec === "plan") return `«encoded plan, ${((value as Hex).length - 2) / 2} bytes»`;
    if (spec === "items") return `${(value as readonly unknown[]).length} item${(value as readonly unknown[]).length === 1 ? "" : "s"}`;
    if (spec === "poolKey") {
      const k = value as { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };
      return `${this.label(k.currency0)} / ${this.label(k.currency1)}, fee ${k.fee}, spacing ${k.tickSpacing}, hook ${this.label(k.hooks)}`;
    }
    return `[${(value as unknown[]).length} calls]`;
  }

  /** A note's issuance, in the words of its term sheet's headline and who serves it. */
  private issuance(p: Issuance): string {
    return [
      `${p.name} (${p.symbol})`,
      `${p.units.toString()} units to ${this.label(p.issuer)}${p.open ? ", opened" : ", paused"}`,
      `${p.terms.schedule.length} observations, the first ${new Date(Number(p.terms.schedule[0]?.date ?? 0) * 1000).toISOString()}`,
      p.isin ? `ISIN ${p.isin}` : "no ISIN",
      `term sheet ${p.termSheetHash} at ${JSON.stringify(p.termSheetUri)}`,
    ].join("; ");
  }

  /** Formatted in the token's own decimals, or as a raw integer when the token is not known. */
  private amount(value: bigint, token: Address): string {
    const t = Object.values(this.manifest.assets).find((a) => same(a.address, token));
    if (UNLIMITED.has(value)) return `unlimited ${t?.symbol ?? "base units"}`;
    if (!t) return `${value.toString()} base units`;
    return `${formatUnits(value, t.decimals)} ${t.symbol}`;
  }

  private kindOf(addr: Address): string | undefined {
    const hit = this.book.get(addr.toLowerCase());
    return hit ? kindOfKey(hit.key) : undefined;
  }

  label(addr: Address): string {
    return this.book.get(addr.toLowerCase())?.label ?? getAddress(addr);
  }

  /** Every contract address the manifest names; the set whose events locate transactions. */
  watched(): Address[] {
    return [...this.book.entries()].filter(([, v]) => !v.key.startsWith("parties.") && !v.key.startsWith("public.")).map(([a]) => getAddress(a));
  }
}

type Issuance = {
  name: string;
  symbol: string;
  units: bigint;
  open: boolean;
  issuer: Address;
  isin: string;
  termSheetHash: Hex;
  termSheetUri: string;
  terms: { schedule: Array<{ date: number | bigint }> };
};

/** A determination's outcome, in cents per Calculation Amount. */
function outcome(o: Record<string, unknown>): string {
  const cents = (v: unknown) => `EUR ${(Number(v) / 100).toFixed(2)}`;
  const parts = [
    o.couponPaid ? `coupon ${cents(o.couponPerCa)} per CA` : "no coupon",
    o.redeemed ? `redeems at ${cents(o.redemptionPerCa)} per CA` : "no redemption",
    o.breached ? "barrier breached" : "no breach",
    `worst performer ${String(o.worstIndex)}`,
  ];
  return parts.join("; ");
}

/** An agent's restrictions, as the powers it keeps. */
function restrictions(r: Record<string, boolean>): string {
  const powers: Array<[string, string]> = [
    ["disableMint", "mint"], ["disableBurn", "burn"], ["disablePartialFreeze", "partial freeze"], ["disableAddressFreeze", "freeze an address"],
    ["disableRecovery", "recover a wallet"], ["disableForceTransfer", "forced transfer"], ["disablePause", "pause"],
  ];
  const kept = powers.filter(([k]) => !r[k]).map(([, n]) => n);
  return kept.length ? `may only ${kept.join(", ")}` : "may do nothing";
}

/** The claim topics of the deployment, by name. */
const TOPICS = new Map<string, string>(
  ["claim.deposit-eligible", "claim.note-eligible", "claim.term-sheet", "claim.pool-access"].map((t) => [BigInt(keccak256(toBytes(t))).toString(), t]),
);
const topicName = (t: bigint) => TOPICS.get(t.toString()) ?? `topic ${t.toString().slice(0, 12)}…`;

/** A claim's data: when issued, when it lapses, and the record's hash; anything else in hex. */
function claimData(data: Hex): string {
  if ((data.length - 2) / 2 !== 96) return `«${(data.length - 2) / 2} bytes»`;
  const word = (i: number) => BigInt(`0x${data.slice(2 + i * 64, 2 + (i + 1) * 64)}`);
  const at = (v: bigint) => new Date(Number(v) * 1000).toISOString().slice(0, 10);
  return `issued ${at(word(0))}, lapses ${at(word(1))}, record hash 0x${data.slice(2 + 128, 2 + 192)}`;
}

const ROLE_NAMES = new Map<string, string>([
  ["0x0000000000000000000000000000000000000000000000000000000000000000", "DEFAULT_ADMIN_ROLE"],
  ...[
    "MINTER_ROLE", "BURNER_ROLE", "PAUSER_ROLE", "ENFORCER_ROLE", "ERC20ENFORCER_ROLE", "SNAPSHOOTER_ROLE",
    "DOCUMENT_ROLE", "EXTRA_INFORMATION_ROLE", "FORCED_TRANSFER_ROLE", "PROXY_UPGRADE_ROLE", "DEPOSIT_AGENT_ROLE", "SUPERVISOR_ROLE",
  ].map((r) => [keccak256(toBytes(r)), r] as [string, string]),
]);

/** A 32-byte reference: text when it is printable text padded with zeros, otherwise hex. */
export function ref(value: Hex): string {
  const bytes = Buffer.from(value.slice(2), "hex");
  const end = bytes.indexOf(0) === -1 ? bytes.length : bytes.indexOf(0);
  const head = bytes.subarray(0, end);
  const printable = end > 0 && head.every((b) => b >= 0x20 && b < 0x7f) && bytes.subarray(end).every((b) => b === 0);
  return printable ? JSON.stringify(head.toString("latin1")) : value;
}

/** A reason payload shown as text when it is UTF-8, and in full hex when it is not. */
export function reason(data: Hex): string {
  const bytes = Buffer.from(data.slice(2), "hex");
  try {
    return JSON.stringify(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return data;
  }
}

function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * The most recent transactions, as tape rows, newest first.
 *
 * Transactions are located by the events the manifest's contracts emitted, which is cheap on
 * any node. A transaction that emitted no such event does not appear: in particular a reverted
 * one. That coverage limit is stated here rather than hidden; closing it needs an indexer that
 * reads every transaction sent to a watched address.
 */
export async function readTape(client: PublicClient, tape: Tape, limit = 20, fromBlock = 0n, addresses: Address[] = tape.watched()): Promise<TapeRow[]> {
  const logs = await client.getLogs({ address: addresses, fromBlock, toBlock: "latest" });
  logs.sort((x, y) => Number((y.blockNumber ?? 0n) - (x.blockNumber ?? 0n)) || (y.logIndex ?? 0) - (x.logIndex ?? 0));

  // The newest `limit` transactions, fetched a batch at a time, then described in order.
  const hashes: Hex[] = [];
  for (const log of logs) {
    if (!log.transactionHash || hashes.includes(log.transactionHash)) continue;
    hashes.push(log.transactionHash);
    if (hashes.length >= limit) break;
  }
  const txs = [];
  for (let i = 0; i < hashes.length; i += 10) {
    txs.push(...(await Promise.all(hashes.slice(i, i + 10).map((hash) => client.getTransaction({ hash })))));
  }
  const rows: TapeRow[] = [];
  for (const tx of txs) {
    const at = { hash: tx.hash, block: Number(tx.blockNumber), from: tx.from };
    if (!tx.to) {
      const receipt = await client.getTransactionReceipt({ hash: tx.hash });
      rows.push(tape.describeCreation(at, receipt.contractAddress ?? undefined));
      continue;
    }
    rows.push(...tape.describe({ ...at, to: tx.to, input: tx.input }));
  }
  return rows;
}
