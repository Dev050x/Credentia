use anchor_lang::{
    prelude::*,
    system_program::{transfer, Transfer},
};
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenInterface},
};

use crate::error::ErrorCode;
use crate::{events::LoanFunded, Loan, LoanStatus, Platform};

#[derive(Accounts)]
pub struct FundBorrower<'info> {
    #[account(mut)]
    pub lender: Signer<'info>,
    #[account(mut)]
    pub borrower: SystemAccount<'info>,
    pub borrower_nft_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        has_one = borrower,
        seeds = [b"loan" , borrower_nft_mint.key().as_ref() , platform.key().as_ref()],
        bump = loan_account.bump,
    )]
    pub loan_account: Account<'info, Loan>,
    #[account(
        seeds = [b"platform"],
        bump = platform.bump,
    )]
    pub platform: Account<'info, Platform>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

impl<'info> FundBorrower<'info> {
    pub fn fund_borrower(&mut self) -> Result<()> {
        require!(self.loan_account.lender.is_none(), ErrorCode::LoanFunded);
        require!(
            self.loan_account.status == LoanStatus::Requested,
            ErrorCode::LoanNotActive
        );
        require!(
            self.lender.lamports() >= self.loan_account.loan_amount,
            ErrorCode::InsufficientBalance
        );

        //transfering fund to borrower
        let cpi_context = CpiContext::new(
            self.system_program.to_account_info(),
            Transfer {
                from: self.lender.to_account_info(),
                to: self.borrower.to_account_info(),
            },
        );
        transfer(cpi_context, self.loan_account.loan_amount)?;

        //updating the field
        self.loan_account.lender = Some(self.lender.key());
        let current_time = Clock::get()?.unix_timestamp;
        self.loan_account.start_time = Some(current_time);
        self.loan_account.status = LoanStatus::Funded;
        emit!(LoanFunded {
            lender: self.lender.key(),
            loan_amount: self.loan_account.loan_amount,
            funded_at: current_time,
        });

        Ok(())
    }
}
