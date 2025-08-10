use anchor_lang::prelude::*;

#[event]
pub struct LoanFunded {
    pub lender: Pubkey,
    pub loan_amount: u64,
    pub funded_at: i64,
}

#[event]
pub struct LoanRequested {
    pub borrower: Pubkey,
    pub nft_mint: Pubkey,
    pub loan_amount: u64,
    pub duration: u32,
    pub interest_rate: u8,
    pub timestamp: u64,
}

#[event]
pub struct LoanRepaid {
    pub loan: Pubkey,
    pub borrower: Pubkey,
    pub lender: Pubkey,
    pub repaid_amount: u64,
    pub fee_for_platform: u64,
    pub timestamp: i64,
}

#[event]
pub struct NFTClaimed {
    pub loan: Pubkey,
    pub borrower: Pubkey,
    pub nft_mint: Pubkey,
    pub timestamp: i64,
}
