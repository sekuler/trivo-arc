/**
 * Vercel serverless RPC proxy for Arc Mainnet.
 * Forwards JSON-RPC requests server-side so the browser never calls the Arc RPC
 * endpoints directly (which would be blocked by CORS on non-Arc-Studio origins).
 *
 * Allowed methods: only the read/send operations the app actually needs.
 * Body size capped at 64 KB.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'

// arc-studio-allow-onchain-literal
const UPSTREAM_PRIMARY  = 'https://rpc.mainnet.arc.io'
// arc-studio-allow-onchain-literal
const UPSTREAM_FALLBACK = 'https://rpc.drpc.mainnet.arc.io'
const MAX_BODY_BYTES = 64 * 1024

const ALLOWED_METHODS = new Set([
  'eth_chainId',
  'eth_blockNumber',
  'eth_call',
  'eth_getBalance',
  'eth_getLogs',
  'eth_getTransactionReceipt',
  'eth_getTransactionByHash',
  'eth_estimateGas',
  'eth_gasPrice',
  'eth_maxPriorityFeePerGas',
  'eth_feeHistory',
  'eth_getBlockByNumber',
  'eth_getCode',
  'eth_getTransactionCount',
])

type JsonRpcRequest = {
  jsonrpc: string
  method:  string
  params?: unknown
  id?:     unknown
}

function isBatch(body: unknown): body is JsonRpcRequest[] {
  return Array.isArray(body)
}

function methodsOf(body: JsonRpcRequest | JsonRpcRequest[]): string[] {
  return isBatch(body) ? body.map((r) => r.method) : [body.method]
}

function errorResponse(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }
}

async function forward(body: unknown): Promise<{ status: number; json: unknown }> {
  const text = JSON.stringify(body)
  const opts: RequestInit = {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    text,
  }
  for (const url of [UPSTREAM_PRIMARY, UPSTREAM_FALLBACK]) {
    try {
      const res = await fetch(url, opts)
      if (res.ok) return { status: res.status, json: await res.json() }
    } catch {
      // network error — try fallback
    }
  }
  throw new Error('All upstream endpoints failed')
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const contentLength = Number(req.headers['content-length'] ?? 0)
  if (contentLength > MAX_BODY_BYTES) {
    res.status(413).json({ error: 'Request body too large' })
    return
  }

  const body = req.body as JsonRpcRequest | JsonRpcRequest[] | undefined
  if (!body) {
    res.status(400).json({ error: 'Empty body' })
    return
  }

  const methods = methodsOf(body)
  const forbidden = methods.find((m) => !ALLOWED_METHODS.has(m))
  if (forbidden) {
    const id = isBatch(body) ? null : (body as JsonRpcRequest).id
    res.status(403).json(errorResponse(id, -32601, `Method not allowed: ${forbidden}`))
    return
  }

  try {
    const { status, json } = await forward(body)
    res.status(status).json(json)
  } catch (err) {
    const id = isBatch(body) ? null : (body as JsonRpcRequest).id
    const msg = err instanceof Error ? err.message : 'Upstream error'
    res.status(502).json(errorResponse(id, -32000, msg))
  }
}
