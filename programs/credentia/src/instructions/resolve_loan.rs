use anchor_lang::{
    prelude::*,
    system_program::{transfer, Transfer},
};
use anchor_spl::{
    associated_token::AssociatedToken, token::{close_account, transfer_checked, CloseAccount, TransferChecked}, token_interface::{Mint, TokenAccount, TokenInterface}
};

use crate::{error::ErrorCode, events::{LoanRepaid, NFTClaimed}, Loan, LoanStatus, Platform};

#[derive(Accounts)]
pub struct ResolveLoan<'info> {
    #[account(mut)]
    pub borrower: Signer<'info>,
    #[account(mut)]
    pub lender: SystemAccount<'info>,
    pub borrower_nft_mint: InterfaceAccount<'info, Mint>,
    #[account(
        init_if_needed,
        payer = borrower,
        associated_token::mint = borrower_nft_mint,
        associated_token::authority = borrower,
    )]
    pub borrower_nft_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(
        seeds = [b"platform"],
        bump = platform.bump,
    )]
    pub platform: Account<'info, Platform>,
    #[account(
        mut,
        has_one = borrower,
        close = borrower,
        seeds = [b"loan" , borrower_nft_mint.key().as_ref() , platform.key().as_ref()],
        bump = loan_account.bump,
    )]
    pub loan_account: Account<'info, Loan>,
    #[account(
        mut,
        associated_token::mint = borrower_nft_mint,
        associated_token::authority = loan_account,
    )]
    pub nft_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        seeds = [b"treasury_vault", platform.key().as_ref()],
        bump,
    )]
    pub treasury_vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

impl<'info> ResolveLoan<'info> {
    //borrower transfer fee(interest * percentage of fee) to marketplace and transfer fund to lender(amount + interest-marketplace fee)
    pub fn transfer_amount(&mut self) -> Result<()> {
        let start_time = self.loan_account.start_time.ok_or(ErrorCode::LoanDefaulted)?;
        require!(
            Clock::get()?.unix_timestamp - start_time
                <= self.loan_account.duration as i64,
            ErrorCode::LoanDefaulted
        );
        require!(
            self.loan_account.status != LoanStatus::Repaid,
            ErrorCode::LoanRepaided
        );
        require!(
            self.loan_account.status != LoanStatus::Defaulted,
            ErrorCode::LoanDefaulted
        );
        //NOTE: if you have to change this if you change in future
        require!(self.loan_account.lender == Some(self.lender.key()) , ErrorCode::LenderNotMatched);

        let loan_amount = self.loan_account.loan_amount;
        let interest_rate = self.loan_account.interest_rate;
        let platform_fee = self.platform.fee_bps;
        //total interest to pay
        let interest_amount = loan_amount
            .checked_mul(interest_rate as u64)
            .unwrap()
            .checked_div(10000_u64)
            .unwrap();
        //fee for platform
        let fee_for_platform = interest_amount
            .checked_mul(platform_fee as u64)
            .unwrap()
            .checked_div(10000_u64)
            .unwrap();
        //total amount to pay lender
        let amount_to_pay_lender = loan_amount
            .checked_add(interest_amount)
            .unwrap()
            .checked_sub(fee_for_platform)
            .unwrap();
        require!(self.borrower.lamports() >= amount_to_pay_lender + fee_for_platform , ErrorCode::InsufficientBalance);

        //transfering fee to platform
        let cpi_context_1 = CpiContext::new(
            self.system_program.to_account_info(),
            Transfer {
                from: self.borrower.to_account_info(),
                to: self.treasury_vault.to_account_info(),
            },
        );
        transfer(cpi_context_1, fee_for_platform)?;

        //transfering amount to lender
        let cpi_context_2 = CpiContext::new(
            self.system_program.to_account_info(),
            Transfer {
                from: self.borrower.to_account_info(),
                to: self.lender.to_account_info(),
            },
        );
        transfer(cpi_context_2, amount_to_pay_lender)?;

        //updating Field
        self.loan_account.status = LoanStatus::Repaid;
        emit!(LoanRepaid {
            loan: self.loan_account.key(),
            borrower: self.borrower.key(),
            lender: self.lender.key(),
            repaid_amount: amount_to_pay_lender,
            fee_for_platform,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    //now borrower can resolve the loan(transfering back the NFT to the borrower from the nft_vault and close the vault account and laon account)
    pub fn claim_nft(&mut self) -> Result<()> {
        require!(self.loan_account.status == LoanStatus::Repaid , ErrorCode::LoanNotRepaided);
        let seeds = &[
            b"loan".as_ref(),
            &self.borrower_nft_mint.key().to_bytes()[..],
            &self.platform.key().to_bytes()[..],
            &[self.loan_account.bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let cpi_context = CpiContext::new_with_signer(self.token_program.to_account_info(), TransferChecked{
            from: self.nft_vault.to_account_info(),
            mint: self.borrower_nft_mint.to_account_info(),
            to: self.borrower_nft_ata.to_account_info(),
            authority: self.loan_account.to_account_info(),
        },signer_seeds);

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

        emit!(NFTClaimed {
            loan: self.loan_account.key(),
            borrower: self.borrower.key(),
            nft_mint: self.borrower_nft_mint.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }
}
