use anchor_lang::prelude::*;

#[account]
pub struct Loan {
    pub borrower: Pubkey,
    pub lender: Option<Pubkey>,
    pub nft_mint: Pubkey,
    pub loan_amount: u64,
    pub duration: u32,
    pub start_time: Option<i64>,
    pub status: LoanStatus,
    pub time_of_liquidation_or_repayment: Option<u32>,
    pub interest_rate: u16,
    pub bump: u8,
}

impl Loan {
    pub const MAX_SPACE: usize = 32 + // borrower
        1 + 32 + // Option<Pubkey> = tag + value
        32 + // nft_mint
        8 +  // loan_amount
        4 +  // duration
        1 + 8 + // Option<u32> (start_time)
        1 + // LoanStatus
        1 + 4 + // Option<u32> (time_of_liquidation_or_repayment)
        1 + // interest_rate
        1; // bump
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum LoanStatus {
    Requested,
    Funded,
    Repaid,
    Defaulted,
}
