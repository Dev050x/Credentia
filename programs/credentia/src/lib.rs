#![allow(unexpected_cfgs)]
#![allow(deprecated)]
pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("74RfkJTR8xAGJZZfapADruyj8rfvAv1qQpaz2pVfFxdb");

#[program]
pub mod credentia {
    use super::*;
    //admin initialized the platform
    pub fn initialize_platform(ctx: Context<Initialize> , fee_bps: u16) -> Result<()> {
        ctx.accounts.init(fee_bps, &ctx.bumps)?;
        Ok(())
    }
    //borrower request the loan
    //duration in seconds
    pub fn request_loan(ctx: Context<CreateLoan> , amount: u64,duration: u32,interest_rate: u16) -> Result<()> {
        ctx.accounts.create_loan(amount, duration, interest_rate, &ctx.bumps)?;
        ctx.accounts.transfer_nft_vault()?;
        Ok(())
    }
    //borrower resolve the loan
    pub fn resolve_loan(ctx: Context<ResolveLoan>) -> Result<()>{
        ctx.accounts.transfer_amount()?;
        ctx.accounts.claim_nft()?;
        Ok(())
    }
    //lender fund the borrower
    pub fn fund_borrower(ctx: Context<FundBorrower>) -> Result<()>{
        ctx.accounts.fund_borrower()?;
        Ok(())
    }
    //lender default loan
    pub fn default_loan(ctx: Context<DefaultLoan>) -> Result<()>{
        ctx.accounts.claim_nft()?;
        Ok(())
    }

}
