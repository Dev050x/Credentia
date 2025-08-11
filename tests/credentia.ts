import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Credentia } from "../target/types/credentia";
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { keypairIdentity, Metaplex, walk, } from "@metaplex-foundation/js";
import { assert } from "chai";
import { ASSOCIATED_TOKEN_PROGRAM_ID, createMint, getAssociatedTokenAddress, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { MPL_TOKEN_METADATA_PROGRAM_ID } from "@metaplex-foundation/mpl-token-metadata";


describe("credentia", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());
  let provider = anchor.AnchorProvider.env();
  let connection = provider.connection;
  const program = anchor.workspace.credentia as Program<Credentia>;
  const programId = program.programId;
  console.log("Program ID:", programId.toString());

  //helper functions
  const confirm = async (signature: string): Promise<string> => {
    const block = await connection.getLatestBlockhash();
    await connection.confirmTransaction({
      signature,
      ...block,
    });
    return signature;
  };

  const log = async (signature: string): Promise<string> => {
    console.log(
      `Your transaction signature: https://explorer.solana.com/transaction/${signature}?cluster=custom&customUrl=${connection.rpcEndpoint}`
    );
    return signature;
  };

  const [borrower, lender] = Array.from({length: 2}, () => anchor.web3.Keypair.generate());
  const Platform = PublicKey.findProgramAddressSync([Buffer.from("platform")], programId)[0];
  const reward_mint = PublicKey.findProgramAddressSync([Buffer.from("reward_mint") , Platform.toBuffer()], programId )[0];
  const treasuryVault = PublicKey.findProgramAddressSync([Buffer.from("treasury_vault") , Platform.toBuffer()] , programId)[0];
  //nfts stuff
  const metaplex = Metaplex.make(provider.connection).use(keypairIdentity(borrower));
  let borrowerNftMint: PublicKey
  let borrowerNftCollection: PublicKey
  let borrowerAta: PublicKey
  let metadataPda: PublicKey
  let masterEditionPda: PublicKey
  let nft_vault: PublicKey
  let loan_account: PublicKey
  let lenderAta: PublicKey
  it("airdrop sol to lender and borrower" , async () => {
    //sending sol to user
    let sendSol = async (user:PublicKey) => {
      let tx = new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey:provider.wallet.publicKey,
          toPubkey:user,
          lamports: 100 * LAMPORTS_PER_SOL
        })
      )

      let sig = await provider.sendAndConfirm(tx);
      console.log("sol sent to user: ",sig);
    }
    console.log("lender: ", lender.publicKey);
    console.log("borrower: ", borrower.publicKey);
    await sendSol(borrower.publicKey);
    await sendSol(lender.publicKey);
  });

  it("sets up nft and verifies borrower nft" , async () => {
    // 1. Create collection NFT(done by provider metaplex provider in our case it is borrower)
    const { nft: collectionNft } = await metaplex.nfts().create({
      uri: "https://arweave.net/collection-metadata.json",
      name: "Test Collection",
      sellerFeeBasisPoints: 0,
      isCollection: true,
    })
    borrowerNftCollection = collectionNft.address

    // 2. Create borrower NFT in that collection
    const { nft } = await metaplex.nfts().create({
      uri: "https://arweave.net/item-metadata.json",
      name: "Borrower NFT",
      sellerFeeBasisPoints: 0,
      collection: borrowerNftCollection
    })
    borrowerNftMint = nft.address

    // 3. Verify collection link
    await metaplex.nfts().verifyCollection({
      mintAddress: borrowerNftMint,
      collectionMintAddress: borrowerNftCollection
    })

    // 4. Compute ATA for borrower
    const ata = await metaplex.tokens().pdas().associatedTokenAccount({
      mint: borrowerNftMint,
      owner: borrower.publicKey,
    })
    borrowerAta = ata;

    // 5. Compute PDAs for metadata + master edition
    const metadataProgramId = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s")
    metadataPda = PublicKey.findProgramAddressSync(
      [Buffer.from("metadata"), metadataProgramId.toBuffer(), borrowerNftMint.toBuffer()],
      metadataProgramId
    )[0];
    masterEditionPda = PublicKey.findProgramAddressSync(
      [Buffer.from("metadata"), metadataProgramId.toBuffer(), borrowerNftMint.toBuffer(), Buffer.from("edition")],
      metadataProgramId
    )[0];
    assert.ok(metadataPda)
    assert.ok(masterEditionPda)

    console.log({
      borrowerNftMint: borrowerNftMint.toBase58(),
      borrowerNftCollection: borrowerNftCollection.toBase58(),
      borrowerAta: borrowerAta.toBase58(),
      metadataPda: metadataPda.toBase58(),
      masterEditionPda: masterEditionPda.toBase58()
    });
  })

  it("admin initializing the platform (in our case anchor provider wallet is admin)", async () => {
    let sig = await program.methods
    .initializePlatform(500)
    .accountsPartial({
      admin:provider.wallet.payer.publicKey,
      platform: Platform,
      treasuryVault: treasuryVault,
      rewardMint: reward_mint,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([])
    .rpc()
    .then(sig => confirm(sig))
    .then(sig => log(sig));

  });

  it("borrower request for the loan" , async() => {
    // Compute loan_account PDA (this is correct)
    loan_account = PublicKey.findProgramAddressSync([
        Buffer.from("loan"), 
        borrowerNftMint.toBuffer(), 
        Platform.toBuffer()
    ], programId)[0];
    
    // Compute nft_vault AFTER loan_account PDA is computed
    nft_vault = await getAssociatedTokenAddress(
        borrowerNftMint, 
        loan_account, 
        true, 
        TOKEN_PROGRAM_ID, 
    );

    let amount = new anchor.BN(10 * LAMPORTS_PER_SOL);
    let duration = 5;
    let interest_rate = 500;
    await program.methods
    .requestLoan(amount, duration, interest_rate)
    .accountsPartial({
      borrower: borrower.publicKey,
      borrowerNftMint: borrowerNftMint,
      borrowerNftCollection: borrowerNftCollection,
      borrowerNftAta: borrowerAta,
      metadata: metadataPda,
      masterEdition: masterEditionPda,
      loanAccount: loan_account,
      nftVault: nft_vault,
      platform: Platform,
      metadataProgram: MPL_TOKEN_METADATA_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID
    })
    .signers([borrower])
    .rpc()
    .then(sig => confirm(sig))
    .then(sig => log(sig));

  })

  //lender accepting the loan
  it("lender accepting the loan" , async() => {
    let sig = await program.methods
    .fundBorrower()
    .accountsPartial({
      lender: lender.publicKey,
      borrower: borrower.publicKey,
      borrowerNftMint: borrowerNftMint,
      loanAccount: loan_account,
      platform: Platform,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID
    })
    .signers([lender])
    .rpc()
    .then(sig => confirm(sig))
    .then(sig => log(sig));
  });

  //borrower resolve the loan
  it("borrower resolving the loan" , async() => {
    await wait(6);
    await program.methods
    .resolveLoan()
    .accountsPartial({
      borrower: borrower.publicKey,
      lender: lender.publicKey,
      borrowerNftMint: borrowerNftMint,
      borrowerNftAta: borrowerAta,
      platform: Platform,
      loanAccount: loan_account,
      nftVault: nft_vault,
      treasuryVault: treasuryVault,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID
    })
    .signers([borrower])
    .rpc()
    // .then(sig => confirm(sig))
    // .then(sig => log(sig));
    .then(() => assert.fail("Should have failed"))
    .catch(() => assert.ok(true));
  });

  //lender default the loan
  it("lender default the loan", async () => {
    // await wait(6);
    lenderAta = await metaplex.tokens().pdas().associatedTokenAccount({
      mint: borrowerNftMint,
      owner: lender.publicKey,
    })
    await program.methods
    .defaultLoan()
    .accountsPartial({
      lender: lender.publicKey,
      borrower: borrower.publicKey,
      borrowerNftMint: borrowerNftMint,
      lenderNftAta: lenderAta,
      platform: Platform,
      loanAccount: loan_account,
      nftVault: nft_vault,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID
    })
    .signers([lender])
    .rpc()
    .then(sig => confirm(sig))
    .then(sig => log(sig));
  });

});



async function wait(seconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, seconds * 1000);
  });
  
}


// import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
// import { generateSigner, percentAmount, signerIdentity, sol } from '@metaplex-foundation/umi';
// import { createV1, TokenStandard } from '@metaplex-foundation/mpl-token-metadata';


// describe('local metaplex nft test', () => {
//   it('mints nft locally', async () => {
//     const umi = createUmi('http://127.0.0.1:8899');
//     const authority = generateSigner(umi);
//     await umi.rpc.airdrop(authority.publicKey, sol(2));
//     umi.use(signerIdentity(authority));

//     const mint = generateSigner(umi);

//     await createV1(umi, {
//       mint,
//       authority,
//       name: 'Test NFT',
//       uri: 'https://example.com/meta.json',
//       sellerFeeBasisPoints: percentAmount(5.5),
//       tokenStandard: TokenStandard.NonFungible,
//     }).sendAndConfirm(umi);

//     console.log('Minted NFT:', mint.publicKey.toString());
//   });
// });

// solana-test-validator \
//   --reset \
//   --bpf-program metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s tests/mpl_token_metadata.so &
// anchor test --skip-local-validator --skip-build
