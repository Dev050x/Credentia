use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Platform {
    pub authority: Pubkey,
    pub fee_bps: u16,
    pub reward_bump: u8,
    pub treasury_bump: u8,
    pub bump: u8,
}
