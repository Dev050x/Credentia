use anchor_lang::prelude::*;
use anchor_spl::{associated_token::AssociatedToken, token::{ close_account, transfer_checked, CloseAccount, TransferChecked}, token_interface::{Mint, TokenAccount, TokenInterface}};

use crate::{error::ErrorCode, events::LoanCancelled, Loan, LoanStatus, Platform};

//borrower cancel the loan
#[derive(Accounts)]
pub struct BorrowerCancelLoan<'info> {
    #[account(mut)]
    pub borrower: Signer<'info>,
    pub borrower_nft_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = borrower_nft_mint,
        associated_token::authority = borrower,
    )]
    pub borrower_nft_ata: InterfaceAccount<'info, TokenAccount>,
    
    #[account(
        mut,
        has_one  = borrower,
        close = borrower,
        seeds = [b"loan" , borrower_nft_mint.key().as_ref() , platform.key().as_ref()],
        bump=loan_account.bump,
    )]
    pub loan_account: Account<'info, Loan>,

    #[account(
        mut,
        associated_token::mint = borrower_nft_mint,
        associated_token::authority = loan_account,
    )]
    pub nft_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        seeds = [b"platform"],
        bump = platform.bump,
    )]
    pub platform: Account<'info, Platform>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

impl<'info> BorrowerCancelLoan<'info>{
    pub fn cancel_loan(&mut self) -> Result<()> {
        require!(self.loan_account.status == LoanStatus::Requested , ErrorCode::LoanAlreadyFunded);
        
        //transfering nft to borrower
        let seeds = &[
            b"loan".as_ref(),
            &self.borrower_nft_mint.key().to_bytes()[..],
            &self.platform.key().to_bytes()[..],
            &[self.loan_account.bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let cpi_context = CpiContext::new_with_signer(
            self.token_program.to_account_info(),
            TransferChecked {
                from: self.nft_vault.to_account_info(),
                mint: self.borrower_nft_mint.to_account_info(),
                to: self.borrower_nft_ata.to_account_info(),
                authority: self.loan_account.to_account_info(),
            },
            signer_seeds,
        );
        transfer_checked(cpi_context, 1, self.borrower_nft_mint.decimals)?;

        //closing nft_vault account
        // close the nft_vault token account (returns rent to borrower)
        let cpi_close = CpiContext::new_with_signer(
            self.token_program.to_account_info(),
            CloseAccount {
                account: self.nft_vault.to_account_info(),
                destination: self.borrower.to_account_info(),
                authority: self.loan_account.to_account_info(),
            },
            signer_seeds,
        );
        close_account(cpi_close)?;

        emit!(LoanCancelled {
            borrower: self.borrower.key(),
            nft_mint: self.borrower_nft_mint.key(),
            platform: self.platform.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });



        Ok(())
    }
}