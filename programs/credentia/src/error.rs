use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Invalild Loan Amount")]
    InvalidAmountError,
    #[msg("Invalid Duration")]
    InvalidDurationError,
    #[msg("Loan Funded")]
    LoanFunded,
    #[msg("Loan either Completed")]
    LoanNotActive,
    #[msg("Insuficient Balance")]
    InsufficientBalance,
    #[msg("Loan Defaulted")]
    LoanDefaulted,
    #[msg("Loan Already Repaid")]
    LoanRepaided,
    #[msg("Loan Not Paid yet")]
    LoanNotRepaided,
    #[msg("Lender not matched")]
    LenderNotMatched,
    #[msg("Loan already repaid")]
    LoanAlreadyRepaid,
    #[msg("Wait for loan to complete")]
    WaitForLoanToComplete,
    #[msg("Loan already defaulted")]
    LoanAlreadyDefaulted,
    #[msg("Loan not started yet")]
    LoanNotStarted,
}
