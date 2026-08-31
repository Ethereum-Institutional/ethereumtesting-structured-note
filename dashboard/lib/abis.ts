// Hand-written minimal ABIs. Only the calls the dashboard actually makes, so the two
// compilation units (T-REX at solc 0.8.17, venue at 0.8.26) can be read from one client.

export const TREX_TOKEN_ABI = [
  { type: "function", name: "name", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { type: "function", name: "symbol", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { type: "function", name: "decimals", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" },
  { type: "function", name: "totalSupply", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "paused", inputs: [], outputs: [{ type: "bool" }], stateMutability: "view" },
  { type: "function", name: "balanceOf", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "isFrozen", inputs: [{ type: "address" }], outputs: [{ type: "bool" }], stateMutability: "view" },
  { type: "function", name: "getFrozenTokens", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "identityRegistry", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "compliance", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  // agent actions
  { type: "function", name: "setAddressFrozen", inputs: [{ type: "address" }, { type: "bool" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "freezePartialTokens", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "unfreezePartialTokens", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "forcedTransfer", inputs: [{ type: "address" }, { type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
  { type: "function", name: "pause", inputs: [], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "unpause", inputs: [], outputs: [], stateMutability: "nonpayable" },
] as const;

export const IDENTITY_REGISTRY_ABI = [
  { type: "function", name: "isVerified", inputs: [{ type: "address" }], outputs: [{ type: "bool" }], stateMutability: "view" },
  { type: "function", name: "contains", inputs: [{ type: "address" }], outputs: [{ type: "bool" }], stateMutability: "view" },
  { type: "function", name: "identity", inputs: [{ type: "address" }], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "investorCountry", inputs: [{ type: "address" }], outputs: [{ type: "uint16" }], stateMutability: "view" },
] as const;

export const CHECKER_ABI = [
  {
    type: "function",
    name: "explain",
    inputs: [{ type: "address", name: "account" }, { type: "address", name: "tokenAddress" }],
    outputs: [
      { type: "bool", name: "registeredAsset" },
      { type: "bool", name: "assetPaused" },
      { type: "bool", name: "walletFrozen" },
      { type: "bool", name: "identityVerified" },
      { type: "bool", name: "countryPermitted" },
      { type: "bool", name: "holdsLiquidityClaim" },
      { type: "bytes2", name: "flags" },
    ],
    stateMutability: "view",
  },
  { type: "function", name: "checkAllowlist", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "bytes2" }], stateMutability: "view" },
  {
    type: "function",
    name: "policyOf",
    inputs: [{ type: "address" }],
    outputs: [
      { type: "bool", name: "enabled" },
      { type: "address", name: "identityRegistry" },
      { type: "uint256", name: "liquidityClaimTopic" },
      { type: "bool", name: "enforceCountry" },
    ],
    stateMutability: "view",
  },
  { type: "function", name: "isCountryAllowed", inputs: [{ type: "address" }, { type: "uint16" }], outputs: [{ type: "bool" }], stateMutability: "view" },
  { type: "function", name: "setCountryEnforcement", inputs: [{ type: "address" }, { type: "bool" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "setCountryAllowed", inputs: [{ type: "address" }, { type: "uint16" }, { type: "bool" }], outputs: [], stateMutability: "nonpayable" },
] as const;

export const ADAPTER_ABI = [
  { type: "function", name: "swappingEnabled", inputs: [], outputs: [{ type: "bool" }], stateMutability: "view" },
  { type: "function", name: "totalSupply", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "PERMISSIONED_TOKEN", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "updateSwappingEnabled", inputs: [{ type: "bool" }], outputs: [], stateMutability: "nonpayable" },
] as const;

export const ERC20_ABI = [
  { type: "function", name: "balanceOf", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "allowance", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "decimals", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" },
  { type: "function", name: "approve", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
  { type: "function", name: "transfer", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
] as const;

export const STATE_VIEW_ABI = [
  {
    type: "function",
    name: "getSlot0",
    inputs: [{ type: "bytes32", name: "poolId" }],
    outputs: [
      { type: "uint160", name: "sqrtPriceX96" },
      { type: "int24", name: "tick" },
      { type: "uint24", name: "protocolFee" },
      { type: "uint24", name: "lpFee" },
    ],
    stateMutability: "view",
  },
  { type: "function", name: "getLiquidity", inputs: [{ type: "bytes32" }], outputs: [{ type: "uint128" }], stateMutability: "view" },
] as const;

export const ROUTER_ABI = [
  { type: "function", name: "execute", inputs: [{ type: "bytes", name: "unlockData" }, { type: "uint256", name: "deadline" }], outputs: [], stateMutability: "payable" },
] as const;

export const PERMIT2_ABI = [
  {
    type: "function",
    name: "approve",
    inputs: [{ type: "address" }, { type: "address" }, { type: "uint160" }, { type: "uint48" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

export const CUSTODY_ACCOUNT_ABI = [
  {
    type: "function",
    name: "execute",
    inputs: [
      {
        type: "tuple[]",
        name: "calls",
        components: [
          { type: "address", name: "target" },
          { type: "uint256", name: "value" },
          { type: "bytes", name: "data" },
        ],
      },
    ],
    outputs: [{ type: "bytes[]" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "executeOne",
    inputs: [{ type: "address", name: "target" }, { type: "uint256", name: "value" }, { type: "bytes", name: "data" }],
    outputs: [{ type: "bytes" }],
    stateMutability: "nonpayable",
  },
  { type: "function", name: "clientRef", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { type: "function", name: "CUSTODIAN", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "error", name: "NotCustodian", inputs: [{ type: "address" }] },
] as const;

export const ID_FACTORY_ABI = [
  { type: "function", name: "getIdentity", inputs: [{ type: "address" }], outputs: [{ type: "address" }], stateMutability: "view" },
  {
    type: "function",
    name: "createIdentity",
    inputs: [{ type: "address", name: "wallet" }, { type: "string", name: "salt" }],
    outputs: [{ type: "address" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "createIdentityWithManagementKeys",
    inputs: [{ type: "address", name: "wallet" }, { type: "string", name: "salt" }, { type: "bytes32[]", name: "managementKeys" }],
    outputs: [{ type: "address" }],
    stateMutability: "nonpayable",
  },
] as const;

export const IDENTITY_ABI = [
  { type: "function", name: "getClaimIdsByTopic", inputs: [{ type: "uint256" }], outputs: [{ type: "bytes32[]" }], stateMutability: "view" },
  {
    type: "function",
    name: "getClaim",
    inputs: [{ type: "bytes32", name: "claimId" }],
    outputs: [
      { type: "uint256", name: "topic" },
      { type: "uint256", name: "scheme" },
      { type: "address", name: "issuer" },
      { type: "bytes", name: "signature" },
      { type: "bytes", name: "data" },
      { type: "string", name: "uri" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "addClaim",
    inputs: [
      { type: "uint256", name: "topic" },
      { type: "uint256", name: "scheme" },
      { type: "address", name: "issuer" },
      { type: "bytes", name: "signature" },
      { type: "bytes", name: "data" },
      { type: "string", name: "uri" },
    ],
    outputs: [{ type: "bytes32" }],
    stateMutability: "nonpayable",
  },
] as const;

export const CLAIM_ISSUER_ABI = [
  {
    type: "function",
    name: "isClaimValid",
    inputs: [
      { type: "address", name: "identity" },
      { type: "uint256", name: "claimTopic" },
      { type: "bytes", name: "sig" },
      { type: "bytes", name: "data" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
  { type: "function", name: "keyHasPurpose", inputs: [{ type: "bytes32" }, { type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "view" },
  { type: "function", name: "isClaimRevoked", inputs: [{ type: "bytes" }], outputs: [{ type: "bool" }], stateMutability: "view" },
] as const;

export const IDENTITY_REGISTRY_WRITE_ABI = [
  {
    type: "function",
    name: "registerIdentity",
    inputs: [{ type: "address", name: "userAddress" }, { type: "address", name: "identity" }, { type: "uint16", name: "country" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  { type: "function", name: "contains", inputs: [{ type: "address" }], outputs: [{ type: "bool" }], stateMutability: "view" },
  { type: "function", name: "isVerified", inputs: [{ type: "address" }], outputs: [{ type: "bool" }], stateMutability: "view" },
] as const;

export const TREX_MINT_ABI = [
  { type: "function", name: "mint", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "burn", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
] as const;

export const MODULAR_COMPLIANCE_ABI = [
  { type: "function", name: "addModule", inputs: [{ type: "address" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "removeModule", inputs: [{ type: "address" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "isModuleBound", inputs: [{ type: "address" }], outputs: [{ type: "bool" }], stateMutability: "view" },
  {
    type: "function",
    name: "callModuleFunction",
    inputs: [{ type: "bytes", name: "callData" }, { type: "address", name: "module" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

export const MAX_BALANCE_MODULE_ABI = [
  { type: "function", name: "setMaxBalance", inputs: [{ type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
] as const;

export const DEMO_BASELINE_ABI = [
  { type: "function", name: "snapshotId", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "armedAt", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "isArmed", inputs: [], outputs: [{ type: "bool" }], stateMutability: "view" },
  { type: "function", name: "arm", inputs: [{ type: "uint256" }, { type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
] as const;

export const CUSTODY_FACTORY_ABI = [
  {
    type: "function",
    name: "createAccount",
    inputs: [{ type: "string", name: "clientRef" }],
    outputs: [{ type: "address" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "accountOf",
    inputs: [{ type: "bytes32" }],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "predictAddress",
    inputs: [{ type: "string" }],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
] as const;

export const DEMO_USDC_ABI = [
  { type: "function", name: "mint", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "balanceOf", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
] as const;

export const POSM_ABI = [
  { type: "function", name: "modifyLiquidities", inputs: [{ type: "bytes", name: "unlockData" }, { type: "uint256", name: "deadline" }], outputs: [], stateMutability: "payable" },
  { type: "function", name: "nextTokenId", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "getPositionLiquidity", inputs: [{ type: "uint256" }], outputs: [{ type: "uint128" }], stateMutability: "view" },
  { type: "function", name: "ownerOf", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }], stateMutability: "view" },
  {
    type: "function",
    name: "unwindPosition",
    inputs: [
      { type: "uint256", name: "tokenId" },
      { type: "uint128", name: "amount0Min" },
      { type: "uint128", name: "amount1Min" },
      { type: "bytes", name: "hookData" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;
