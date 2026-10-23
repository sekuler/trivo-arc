/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 *
 * Default: Arc Mainnet. Set VITE_MAINNET=false in .env to switch to testnet.
 * (also fill in your deployed addresses in MAINNET_ADDRESSES in contracts.ts)
 */

import { http, createConfig } from 'wagmi'
import { mainnet, baseSepolia, sepolia, arbitrumSepolia, avalancheFuji, base, arbitrum, avalanche } from 'wagmi/chains'
import { arcTestnet, arc } from 'viem/chains'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'

const IS_MAINNET = import.meta.env.VITE_MAINNET !== 'false'

// Arc Mainnet reads go through the same-origin proxy (/api/rpc) so the browser
// never calls the Arc RPC endpoints directly (which are blocked by CORS outside
// Arc Studio). On Vercel the proxy is a serverless function; in dev Vite forwards
// /api/rpc to rpc.mainnet.arc.io via its built-in proxy config.
const ARC_MAINNET_RPC_PROXY = '/api/rpc'
const ARC_TESTNET_RPC: string = (import.meta.env.VITE_RPC_PROXY_BASE_URL as string | undefined)
  ? `${import.meta.env.VITE_RPC_PROXY_BASE_URL}/api/rpc/Arc_Testnet?_rpc_token=${import.meta.env.VITE_RPC_PROXY_TOKEN}`
  : arcTestnet.rpcUrls.default.http[0]  // https://rpc.testnet.arc.io

registerChain(arcTestnet.id, arcTestnet.rpcUrls.default.http[0])
registerChain(arc.id, arc.rpcUrls.default.http[0])

export const config = IS_MAINNET
  ? createConfig({
      // Arc Mainnet + Gateway source chains (mainnet) + mainnet for ENS
      chains: [arc, base, mainnet, arbitrum, avalanche],
      connectors: [injected()],
      transports: {
        [arc.id]: http(ARC_MAINNET_RPC_PROXY, { retryCount: 2, retryDelay: 600 }),
        [base.id]:      http(),
        [mainnet.id]:   http(),
        [arbitrum.id]:  http(),
        [avalanche.id]: http(),
      },
    })
  : createConfig({
      // Arc Testnet + Gateway source chains (testnet) + mainnet for ENS
      chains: [arcTestnet, baseSepolia, sepolia, arbitrumSepolia, avalancheFuji, mainnet],
      connectors: [injected()],
      transports: {
        [arcTestnet.id]:      http(ARC_TESTNET_RPC, { retryCount: 3 }),
        [baseSepolia.id]:     http(),
        [sepolia.id]:         http(),
        [arbitrumSepolia.id]: http(),
        [avalancheFuji.id]:   http(),
        [mainnet.id]:         http(),
      },
    })
