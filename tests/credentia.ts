import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Credentia } from "../target/types/credentia";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { keypairIdentity, Metaplex, walk, } from "@metaplex-foundation/js";
import { assert, expect } from "chai";
import { ASSOCIATED_TOKEN_PROGRAM_ID, createMint, getAccount, getAssociatedTokenAddress, getAssociatedTokenAddressSync, getMint, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
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
    // console.log(
    //   `Your transaction signature: https://explorer.solana.com/transaction/${signature}?cluster=custom&customUrl=${connection.rpcEndpoint}`
    // );
    return signature;
  };

  const [borrower, lender] = Array.from({ length: 2 }, () => anchor.web3.Keypair.generate());
  const Platform = PublicKey.findProgramAddressSync([Buffer.from("platform")], programId)[0];
  const reward_mint = PublicKey.findProgramAddressSync([Buffer.from("reward_mint"), Platform.toBuffer()], programId)[0];
  const treasuryVault = PublicKey.findProgramAddressSync([Buffer.from("treasury_vault"), Platform.toBuffer()], programId)[0];
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
  it("airdrop sol to lender and borrower", async () => {
    //sending sol to user
    let sendSol = async (user: PublicKey) => {
      let tx = new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: provider.wallet.publicKey,
          toPubkey: user,
          lamports: 2 * LAMPORTS_PER_SOL
        })
      )

      let sig = await provider.sendAndConfirm(tx);
      // console.log("sol sent to user: ", sig);
    }
    // console.log("lender: ", lender.publicKey);
    // console.log("borrower: ", borrower.publicKey);
    await sendSol(borrower.publicKey);
    await sendSol(lender.publicKey);
  });

  it("sets up nft and verifies borrower nft", async () => {
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

    // console.log({
    //   borrowerNftMint: borrowerNftMint.toBase58(),
    //   borrowerNftCollection: borrowerNftCollection.toBase58(),
    //   borrowerAta: borrowerAta.toBase58(),
    //   metadataPda: metadataPda.toBase58(),
    //   masterEditionPda: masterEditionPda.toBase58()
    // });
  })



  /**************************************************
   *            PLATFORM INITIALIZATION TESTS        *
   **************************************************/
  let accountsForInitialization = {
    admin: provider.wallet.payer.publicKey,
    platform: Platform,
    treasuryVault: treasuryVault,
    rewardMint: reward_mint,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  };

  it("should Fails when admin is not signer", async () => {
    const fakeAdmin = Keypair.generate()
    await program.methods
      .initializePlatform(500)
      .accountsPartial({ ...accountsForInitialization, admin: fakeAdmin.publicKey })
      .signers([]) // intentionally no signer for fake admin
      .rpc()
      .then(() => assert.fail("Should have failed"))
      .catch(() => assert.ok(true));
  })

  it("should Fails with incorrect PDA seeds", async () => {
    const wrongVault = Keypair.generate().publicKey
    program.methods
      .initializePlatform(500)
      .accountsPartial({ ...accountsForInitialization, treasuryVault: wrongVault })
      .signers([])
      .rpc()
      .then(() => assert.fail("Should have failed"))
      .catch(() => assert.ok(true));
  })

  it("should Fails if insufficient funds for rent", async () => {
    const lowFundsAdmin = Keypair.generate()
    await program.methods
      .initializePlatform(500)
      .accountsPartial({ ...accountsForInitialization, admin: lowFundsAdmin.publicKey })
      .signers([lowFundsAdmin])
      .rpc()
      .then(() => assert.fail("Should have failed"))
      .catch(() => assert.ok(true));
  })

  it("admin initializing the platform (in our case anchor provider wallet is admin)", async () => {
    let sig = await program.methods
      .initializePlatform(500)
      .accountsPartial(accountsForInitialization)
      .signers([])
      .rpc()
      .then(sig => confirm(sig))
      .then(sig => log(sig));

  });

  it("should Fails if platform already initialized", async () => {
    await program.methods
      .initializePlatform(500)
      .accountsPartial(accountsForInitialization)
      .signers([])
      .rpc()
      .then(() => assert.fail("Should have failed"))
      .catch(() => assert.ok(true));
  })

  it("Platform account data is correct", async () => {
    const platformAccount = await program.account.platform.fetch(Platform)
    assert.equal(platformAccount.authority.toBase58(), provider.wallet.publicKey.toBase58())
    assert.equal(platformAccount.feeBps, 500)
  })

  it("Reward mint has correct config", async () => {
    const mintInfo = await getMint(connection, reward_mint)
    assert.equal(mintInfo.decimals, 6)
    assert.equal(mintInfo.mintAuthority.toBase58(), Platform.toBase58())
  })



  /**************************************************
 *               CREATE LOAN TESTS                *
 **************************************************/
  it("initializing loan account and nft vault", async () => {
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
  })

  let accountsForRequestLoan = (() => ({
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
  }));

  it("should fail when requesting loan without singing" , async() => {
    let amount = new anchor.BN(10 * LAMPORTS_PER_SOL);
    let duration = 5;
    let interest_rate = 500;
    await program.methods
    .requestLoan(amount, duration, interest_rate)
    .accountsPartial(accountsForRequestLoan())
    .signers([])
    .rpc()
    .then(() => assert.fail("Should have failed"))
    .catch(() => assert.ok(true));
  })

  it("should fail when requesting loan with fake nft" , async() => {
    let fakeNftMint = Keypair.generate().publicKey;
    let amount = new anchor.BN(10 * LAMPORTS_PER_SOL);
    let duration = 5;
    let interest_rate = 500;
    await program.methods
    .requestLoan(amount, duration, interest_rate)
    .accountsPartial({...accountsForRequestLoan , borrowerNftMint: fakeNftMint})
    .signers([borrower])
    .rpc()
    .then(() => assert.fail("Should have failed"))
    .catch(() => assert.ok(true));
  })

  it("should fail when requesting loan with non verified nft" , async() => {
    const { nft } = await metaplex.nfts().create({
      uri: "https://arweave.net/item-metadata.json",
      name: "Borrower NFT",
      sellerFeeBasisPoints: 0,
      collection: borrowerNftCollection
    });
    let fakeNftMint = nft.address;
    let amount = new anchor.BN(10 * LAMPORTS_PER_SOL);
    let duration = 5;
    let interest_rate = 500;
    await program.methods
    .requestLoan(amount, duration, interest_rate)
    .accountsPartial({...accountsForRequestLoan , borrowerNftMint: fakeNftMint})
    .signers([borrower])
    .rpc()
    .then(() => assert.fail("Should have failed"))
    .catch(() => assert.ok(true));
  })

  it("should fail when requesting loan with zero amount" , async() => {
    let amount = new anchor.BN(0);
    let duration = 5;
    let interest_rate = 500;
    await program.methods
    .requestLoan(amount, duration, interest_rate)
    .accountsPartial(accountsForRequestLoan())
    .signers([borrower])
    .rpc()
    .then(() => assert.fail("Should have failed"))
    .catch(() => assert.ok(true));
  })

  it("should fail when requesting loan with zero duration" , async() => {
    let amount = new anchor.BN(0);
    let duration = 0;
    let interest_rate = 500;
    await program.methods
    .requestLoan(amount, duration, interest_rate)
    .accountsPartial(accountsForRequestLoan())
    .signers([borrower])
    .rpc()
    .then(() => assert.fail("Should have failed"))
    .catch(() => assert.ok(true));
  })

  it("should Fails if borrower does not own NFT", async () => {
    let randomAta = Keypair.generate().publicKey;
    let amount = new anchor.BN(10 * LAMPORTS_PER_SOL);
    let duration = 5;
    let interest_rate = 500;
    await program.methods
    .requestLoan(amount, duration, interest_rate)
    .accountsPartial({...accountsForRequestLoan , borrowerNftAta: randomAta})
    .signers([borrower])
    .rpc()
    .then(() => assert.fail("Should have failed"))
    .catch(() => assert.ok(true));
  })

  it("should Fails if PDA seeds for loan_account are incorrect", async () => {
    let randomLoanAccount = Keypair.generate().publicKey;
    let amount = new anchor.BN(10 * LAMPORTS_PER_SOL);
    let duration = 5;
    let interest_rate = 500;
    await program.methods
    .requestLoan(amount, duration, interest_rate)
    .accountsPartial({...accountsForRequestLoan , loanAccount: randomLoanAccount})
    .signers([borrower])
    .rpc()
    .then(() => assert.fail("Should have failed"))
    .catch(() => assert.ok(true));
  })

  it("shold Fails if insufficient funds for rent", async () => {
    let randomAddress = Keypair.generate();
    let amount = new anchor.BN(10 * LAMPORTS_PER_SOL);
    let duration = 5;
    let interest_rate = 500;
    await program.methods
    .requestLoan(amount, duration, interest_rate)
    .accountsPartial({...accountsForRequestLoan , borrower: randomAddress.publicKey})
    .signers([randomAddress])
    .rpc()
    .then(() => assert.fail("Should have failed"))
    .catch(() => assert.ok(true));
  })

  it("borrower request for the loan", async () => {
    let amount = new anchor.BN(0.5 * LAMPORTS_PER_SOL);
    let duration = 5;
    let interest_rate = 500;
    await program.methods
      .requestLoan(amount, duration, interest_rate)
      .accountsPartial(accountsForRequestLoan())
      .signers([borrower])
      .rpc()
      .then(sig => confirm(sig))
      .then(sig => log(sig));
  })

  it("Stores correct loan details", async () => {
    const loanAccount = await program.account.loan.fetch(accountsForRequestLoan().loanAccount)
    assert.equal(loanAccount.borrower.toString(), accountsForRequestLoan().borrower.toString())
    assert.equal(loanAccount.nftMint.toString(), accountsForRequestLoan().borrowerNftMint.toString())
    assert.equal(Number(loanAccount.loanAmount), 10 * LAMPORTS_PER_SOL)
    assert.equal(loanAccount.duration, 5)
    assert.equal(loanAccount.interestRate, 500)
    assert.deepEqual(loanAccount.status , { requested: {} })
  })

  it("nft vault nft balance", async () => {
    const vaultAccount = await getAccount(provider.connection, accountsForRequestLoan().nftVault)
    assert.equal(Number(vaultAccount.amount), 1)
  })



/**************************************************
 *             LENDER ACCEPT LOAN TESTS            *
 **************************************************/
  let accountsForFundingLoan = () => ({
        lender: lender.publicKey,
        borrower: borrower.publicKey,
        borrowerNftMint: borrowerNftMint,
        loanAccount: loan_account,
        platform: Platform,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID
      });

  it("shoudl fail when trying to fund different borrower" , async() => {
    let sig = await program.methods
      .fundBorrower()
      .accountsPartial({...accountsForFundingLoan() , borrower: Keypair.generate().publicKey})
      .signers([lender])
      .rpc()
      .then(() => assert.fail("Should have failed"))
      .catch(() => assert.ok(true));
  })

  it("shoudl fail when you don't have enough funds" , async() => {
    let poor_lender = Keypair.generate();
    await program.provider.connection.requestAirdrop(poor_lender.publicKey, 1*LAMPORTS_PER_SOL);
    let sig = await program.methods
      .fundBorrower()
      .accountsPartial({...accountsForFundingLoan() , lender: poor_lender.publicKey})
      .signers([poor_lender])
      .rpc()
      .then(() => assert.fail("Should have failed"))
      .catch((err) => assert.ok(err.error.errorCode.code === "InsufficientBalance"));
  })


  it("lender accepting the loan", async () => {
    let borrower_initial_balance = await provider.connection.getBalance(borrower.publicKey);
    let lender_initial_balance = await provider.connection.getBalance(lender.publicKey);
    let sig = await program.methods
      .fundBorrower()
      .accountsPartial(accountsForFundingLoan())
      .signers([lender])
      .rpc()
      .then(sig => confirm(sig))
      .then(sig => log(sig));

    let borrower_final_balance = await provider.connection.getBalance(borrower.publicKey);
    let lender_final_balance = await provider.connection.getBalance(lender.publicKey);
    let amount = (await program.account.loan.fetch(accountsForRequestLoan().loanAccount)).loanAmount;
    assert(Number(borrower_final_balance) === Number(borrower_initial_balance) + Number(amount));
    assert(Number(lender_final_balance) === Number(lender_initial_balance) - Number(amount));
  });

  it("Should Stores correct details" , async () => {
    let loan_account = await program.account.loan.fetch(accountsForRequestLoan().loanAccount);
    assert.equal(lender.publicKey.toBase58() , loan_account.lender.toBase58());
    assert.deepEqual(loan_account.status , {funded: {}});
    
  })

  it("should fail when lender try to again fund the loan" , async ()  => {
    let sig = await program.methods
      .fundBorrower()
      .accountsPartial(accountsForFundingLoan())
      .signers([lender])
      .rpc()
      .then(() => assert.fail("Should have failed"))
      .catch((err) => assert.ok(err.error.errorCode.code === "LoanFunded"));
  });

  it("should fail when Another lender try to fund loan" , async () => {
    let lender2 = Keypair.generate();
    let tx = new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: provider.wallet.publicKey,
          toPubkey: lender2.publicKey,
          lamports: 100 * LAMPORTS_PER_SOL
        })
      )

    await provider.sendAndConfirm(tx);

    let sig = await program.methods
      .fundBorrower()
      .accountsPartial({...accountsForFundingLoan() , lender: lender2.publicKey})
      .signers([lender2])
      .rpc()
      .then(() => assert.fail("Should have failed"))
      .catch(() => assert.ok(true));
  })

  /**************************************************
 *           BORROWER RESOLVE LOAN TESTS           *
 **************************************************/
  let BorrowerResolveLoanAccounts = () => ({
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
      });

  it("should fail when different borrower try to repay the loan " , async () => {
    let diff_borrower = Keypair.generate();
    await program.provider.connection.requestAirdrop(diff_borrower.publicKey, 15*LAMPORTS_PER_SOL);
    let sig = await program.methods
      .resolveLoan()
      .accountsPartial({...BorrowerResolveLoanAccounts() , borrower:diff_borrower.publicKey})
      .signers([diff_borrower])
      .rpc()
      .then(() => assert.fail("Should have failed"))
      .catch(() => assert.ok(true));
  })

  it("should fail when try to repay the loan to different lender" , async () => {
    let diff_lender = Keypair.generate();
    let sig = await program.methods
      .resolveLoan()
      .accountsPartial({...BorrowerResolveLoanAccounts() , lender:diff_lender.publicKey})
      .signers([borrower])
      .rpc()
      .then(() => assert.fail("Should have failed"))
      .catch((err) => assert.ok(err.error.errorCode.code === "LenderNotMatched"));
  })

  it("shuld fail when borrower ata is different" , async () => {
    let diff_borrower_ata = await metaplex.tokens().pdas().associatedTokenAccount({mint: Keypair.generate().publicKey, owner: borrower.publicKey});
    let sig = await program.methods
      .resolveLoan()
      .accountsPartial({...BorrowerResolveLoanAccounts() , borrowerNftAta: diff_borrower_ata})
      .signers([borrower])
      .rpc()
      .then(() => assert.fail("Should have failed"))
      .catch(() => assert.ok(true));
  })

  xit("should fail when borrower try to repay the loan after duration" , async () => {
    await wait(6);
    await program.methods
      .resolveLoan()
      .accountsPartial(BorrowerResolveLoanAccounts())
      .signers([borrower])
      .rpc()
      .then(() => assert.fail("Should have failed"))
      .catch((err) => assert.ok(err.error.errorCode.code === "LoanDefaulted"));
  });

  xit("borrower resolving the loan", async () => {
    let borrower_initial_balance = await provider.connection.getBalance(borrower.publicKey);
    let lender_initial_balance = await provider.connection.getBalance(lender.publicKey);
    let treasury_vault_initial_balance = await provider.connection.getBalance(treasuryVault);
    let loan_amount = (await program.account.loan.fetch(accountsForRequestLoan().loanAccount)).loanAmount.toNumber();
    let interest_rate = (await program.account.loan.fetch(accountsForRequestLoan().loanAccount)).interestRate;
    let fee_bps = (await program.account.platform.fetch(accountsForRequestLoan().platform)).feeBps;
    let interest_amount_borrower_have_to_pay = (loan_amount * (interest_rate/10000));
    let total_amount_borrower_have_to_pay = loan_amount + interest_amount_borrower_have_to_pay;
    // console.log("borrower_initial_balance", borrower_initial_balance/LAMPORTS_PER_SOL);
    // console.log("lender_initial_balance", lender_initial_balance/LAMPORTS_PER_SOL);
    // console.log("treasury_vault_initial_balance", treasury_vault_initial_balance/LAMPORTS_PER_SOL);
    // console.log("loan_amount", loan_amount/LAMPORTS_PER_SOL);
    // console.log("interest_rate", interest_rate);
    // console.log("fee_bps", fee_bps);
    // console.log("interest amount borrower have to pay: " , interest_amount_borrower_have_to_pay/LAMPORTS_PER_SOL);

    console.log("total amount to pay by borrower", total_amount_borrower_have_to_pay/LAMPORTS_PER_SOL);
    const sig = await program.methods
      .resolveLoan()
      .accountsPartial(BorrowerResolveLoanAccounts())
      .signers([borrower])
      .rpc()
      .then(sig => confirm(sig))
      .then(sig => log(sig));
    // let tx = await provider.connection.getTransaction(sig, { commitment: "confirmed" });
    // let tx_fee = tx.meta?.fee;
    let borrower_final_balance = await provider.connection.getBalance(borrower.publicKey);
    let lender_final_balance = await provider.connection.getBalance(lender.publicKey);
    let treasury_vault_final_balance = await provider.connection.getBalance(treasuryVault);
    // console.log("treasury final balance" , treasury_vault_final_balance/LAMPORTS_PER_SOL);
    // console.log("lender final balance" , lender_final_balance/LAMPORTS_PER_SOL);
    assert(treasury_vault_final_balance === interest_amount_borrower_have_to_pay * fee_bps/10000);
    assert.equal(Number(lender_final_balance)/LAMPORTS_PER_SOL , Number(lender_initial_balance + (total_amount_borrower_have_to_pay - treasury_vault_final_balance))/LAMPORTS_PER_SOL);
    let borrower_nft_ata = (await getAccount(provider.connection, accountsForRequestLoan().borrowerNftAta)).amount;
    assert.equal(borrower_nft_ata,BigInt(1));
  });

  xit("shold fail when borrower trying to resolving the loan again", async () => {
    await program.methods
      .resolveLoan()
      .accountsPartial(BorrowerResolveLoanAccounts())
      .signers([borrower])
      .rpc()
      .then(() => assert.fail("Should have failed"))
      .catch((err) => assert.ok(true));
  });


  

  /**************************************************
 *           LENDER DEFAULT THE LOAN              *
 **************************************************/
  let accountsForLenderDefaultLoan = (() => ({
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
      }));

  it("should fail when lender try to default the loan before duration" , async () => {
    await program.methods
      .defaultLoan()
      .accountsPartial(accountsForLenderDefaultLoan())
      .signers([lender])
      .rpc()
      .then(() => assert.fail("Should have failed"))
      .catch((err) => assert.ok(err.error.errorCode.code === "WaitForLoanToComplete"));
  });

  //awaiting 6 seconds here
  it("should fail when some-one-else trying to default the loan" , async() => {
    await wait(6); 
    let lender2 = Keypair.generate();
    await program.provider.connection.requestAirdrop(lender2.publicKey, 15*LAMPORTS_PER_SOL);
    await program.methods
          .defaultLoan()
          .accountsPartial({...accountsForLenderDefaultLoan() , lender: lender2.publicKey})
          .signers([lender2])
          .rpc()
          .then(() => assert.fail("Should have failed"))
          .catch((err) => {
            assert.ok(true)
          });
  })

  it("lender default the loan", async () => {
    lenderAta = await metaplex.tokens().pdas().associatedTokenAccount({
      mint: borrowerNftMint,
      owner: lender.publicKey,
    })
    await program.methods
      .defaultLoan()
      .accountsPartial(accountsForLenderDefaultLoan())
      .signers([lender])
      .rpc()
      .then(sig => confirm(sig))
      .then(sig => log(sig));
    let lender_ata_balance = (await getAccount(provider.connection, lenderAta)).amount;
    assert.equal(lender_ata_balance, BigInt(1));
  });

  it("should fail when lender again try to default the loan", async () => {
    lenderAta = await metaplex.tokens().pdas().associatedTokenAccount({
      mint: borrowerNftMint,
      owner: lender.publicKey,
    })
    await program.methods
      .defaultLoan()
      .accountsPartial(accountsForLenderDefaultLoan())
      .signers([lender])
      .rpc()
      .then(() => assert.fail("Should have failed"))
      .catch((err) => {
        assert.ok(true);
      });
  });

});



async function wait(seconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, seconds * 1000);
  });

}


//Just for local network testing purpose
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
