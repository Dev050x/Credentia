use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    metadata::{MasterEditionAccount, Metadata, MetadataAccount},
    token::{transfer_checked, TransferChecked},
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::state::{Loan, LoanStatus, Platform};
use crate::{error::ErrorCode, events::LoanRequested};

//borrower create a loan
#[derive(Accounts)]
pub struct CreateLoan<'info> {
    #[account(mut)]
    pub borrower: Signer<'info>,
    pub borrower_nft_mint: InterfaceAccount<'info, Mint>,
    pub borrower_nft_collection: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = borrower_nft_mint,
        associated_token::authority = borrower,
    )]
    pub borrower_nft_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(
        seeds = [
            b"metadata",
            metadata_program.key().as_ref(),
            borrower_nft_mint.key().as_ref(),
        ],
        seeds::program = metadata_program.key(),
        bump,
        constraint = metadata.collection.as_ref().unwrap().key.as_ref() == borrower_nft_collection.key().as_ref(),
        constraint = metadata.collection.as_ref().unwrap().verified,
    )]
    pub metadata: Account<'info, MetadataAccount>,
    #[account(
        seeds = [
            b"metadata",
            metadata_program.key().as_ref(),
            borrower_nft_mint.key().as_ref(),
            b"edition",
        ],
        seeds::program = metadata_program.key(),
        bump,
    )]
    pub master_edition: Account<'info, MasterEditionAccount>,

    #[account(
        init,
        payer = borrower,
        space = 8 + Loan::MAX_SPACE,
        seeds = [b"loan" , borrower_nft_mint.key().as_ref() , platform.key().as_ref()],
        bump,
    )]
    pub loan_account: Account<'info, Loan>,

    #[account(
        init,
        payer = borrower,
        associated_token::mint = borrower_nft_mint,
        associated_token::authority = loan_account,
    )]
    pub nft_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        seeds = [b"platform"],
        bump = platform.bump,
    )]
    pub platform: Account<'info, Platform>,

    pub metadata_program: Program<'info, Metadata>,
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

impl<'info> CreateLoan<'info> {
    pub fn create_loan(
        &mut self,
        amount: u64,
        duration: u32,
        interest_rate: u16,
        bumps: &CreateLoanBumps,
    ) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmountError);
        require!(duration > 0, ErrorCode::InvalidDurationError);

        self.loan_account.set_inner(Loan {
            borrower: self.borrower.key(),
            nft_mint: self.borrower_nft_mint.key(),
            lender: None,
            loan_amount: amount,
            duration: duration,
            status: LoanStatus::Requested,
            interest_rate: interest_rate,
            bump: bumps.loan_account,
            start_time: None,
            time_of_liquidation_or_repayment: None,
        });
        Ok(())
    }

    pub fn transfer_nft_vault(&mut self) -> Result<()> {
        let cpi_context = CpiContext::new(
            self.token_program.to_account_info(),
            TransferChecked {
                from: self.borrower_nft_ata.to_account_info(),
                mint: self.borrower_nft_mint.to_account_info(),
                to: self.nft_vault.to_account_info(),
                authority: self.borrower.to_account_info(),
            },
        );

        transfer_checked(cpi_context, 1, self.borrower_nft_mint.decimals)?;

        emit!(LoanRequested {
            borrower: self.borrower.to_account_info().key(),
            nft_mint: self.borrower_nft_mint.key(),
            loan_amount: self.loan_account.loan_amount,
            duration: self.loan_account.duration,
            interest_rate: self.loan_account.interest_rate as u8,
            timestamp: Clock::get()?.unix_timestamp as u64,
        });

        Ok(())
    }
}
