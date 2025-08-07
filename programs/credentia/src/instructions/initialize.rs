use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenInterface};

use crate::Platform;

//initializing platform(admin)
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + Platform::INIT_SPACE,
        seeds = [b"platform"],
        bump,
    )]
    pub platform: Account<'info, Platform>,
    #[account(
        seeds = [b"treasury_vault", platform.key().as_ref()],
        bump,
    )]
    pub treasury_vault: SystemAccount<'info>,
    #[account(
        init, 
        payer = admin,
        seeds = [b"reward_mint", platform.key().as_ref()],
        bump,
        mint::decimals = 6,
        mint::authority = platform,
    )]
    pub reward_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

impl<'info> Initialize<'info> {
    pub fn init(&mut self, fee_bps: u16, bumps: &InitializeBumps) -> Result<()> {
        self.platform.set_inner(Platform {
            authority: self.admin.key(),
            fee_bps,
            reward_bump: bumps.reward_mint,
            treasury_bump: bumps.treasury_vault,
            bump: bumps.platform,
        });

        Ok(())
    }
}
