import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createInitializeMintInstruction,
  createMintToInstruction,
  TOKEN_PROGRAM_ID,
  MINT_SIZE,
  getMinimumBalanceForRentExemptMint,
} from "@solana/spl-token";

export interface MintOptions {
  decimals?: number;
  initialSupply?: number;
}

export async function createMintFromVanityAddress(
  connection: Connection,
  payer: PublicKey,
  vanityAddress: PublicKey,
  seed: string,
  options: MintOptions = {}
): Promise<Transaction> {
  const { decimals = 9, initialSupply = 1000000 } = options;

  // Calculate rent for mint account
  const lamports = await getMinimumBalanceForRentExemptMint(connection);

  const transaction = new Transaction();

  // Create mint account
  // transaction.add(
  //   createA(
  //     payer,
  //     vanityAddress,
  //     lamports,
  //     MINT_SIZE,
  //     TOKEN_PROGRAM_ID
  //   )
  // );

  // Initialize mint
  transaction.add(
    createInitializeMintInstruction(
      vanityAddress,
      decimals,
      payer,
      payer,
      TOKEN_PROGRAM_ID
    )
  );

  // Create associated token account for initial mint
  const [associatedTokenAccount] = PublicKey.findProgramAddressSync(
    [payer.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), vanityAddress.toBuffer()],
    new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
  );

  // Create associated token account
  transaction.add(
    createCreateAccountInstruction(
      payer,
      associatedTokenAccount,
      await connection.getMinimumBalanceForRentExemption(165),
      165,
      new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
    )
  );

  // Mint initial supply
  if (initialSupply > 0) {
    transaction.add(
      createMintToInstruction(
        vanityAddress,
        associatedTokenAccount,
        payer,
        initialSupply * Math.pow(10, decimals),
        [],
        TOKEN_PROGRAM_ID
      )
    );
  }

  return transaction;
}
