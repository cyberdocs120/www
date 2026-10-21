/**
 * Baked-in Stellar testnet deployment data.
 *
 * These values are sourced from @wraith-protocol/sdk's canonical Stellar
 * testnet deployment registry (getDeployment('stellar')). They are inlined
 * here as plain constants so that UI components that only display contract
 * addresses (e.g. StellarDeploymentTable) do not pull the full
 * @stellar/stellar-sdk bundle into their chunk.
 *
 * Components that need live Soroban RPC calls (stellarMetrics.ts) import
 * directly from @wraith-protocol/sdk/chains/stellar and are lazy-loaded into
 * their own chunk, so vendor-stellar-sdk only loads when that component mounts.
 *
 * ⚠️  If the SDK deployment registry changes, update these constants to match.
 *     The source of truth is: getDeployment('stellar') from @wraith-protocol/sdk.
 */

export const STELLAR_SOROBAN_URL = 'https://soroban-testnet.stellar.org' as const;

export const STELLAR_CONTRACTS = {
  announcer: 'CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL',
  names: 'CDEMB3MAE62ZOCCKZPTYSXR5CS5WVENPOU5MDVK4PNKTZXFVDC74AFBV',
} as const;

export const STELLAR_EXPLORER_BASE = 'https://stellar.expert/explorer/testnet/contract/';
