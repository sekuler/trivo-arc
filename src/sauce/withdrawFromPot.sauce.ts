// Withdraw all USDC from the Pot back to the owner's wallet.
//
// sauce run withdrawFromPot.sauce.ts --chain arc --args <owner>
//
//   owner: Address — the wallet to send all Pot USDC to
//
// Example:
//   sauce run withdrawFromPot.sauce.ts --chain arc --args 0xYOUR_WALLET

function main(owner: Address) {
  const bal = pot.USDC
  require(bal > 0, "pot is empty")
  USDC.transfer(owner, bal)
}
