# The middle of the chain: overrides sp_hello and calls through super.
SpMid <- R6::R6Class("SpMid",
  inherit = SpBase,
  public = list(
    sp_hello = function() 20,
    sp_mid_run = function() super$sp_deep()
  )
)
