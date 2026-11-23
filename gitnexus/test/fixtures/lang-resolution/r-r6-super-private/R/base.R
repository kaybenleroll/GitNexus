# The root of the chain: a public initialize, a public method also defined below it, a private helper.
SpBase <- R6::R6Class("SpBase",
  public = list(
    initialize = function() 1,
    sp_hello = function() 2,
    sp_deep = function() 3
  ),
  private = list(
    sp_pbase = function() 4
  )
)
# Decoys: free functions that share the member names.
initialize <- function() 100
sp_hello <- function() 101
sp_deep <- function() 102
sp_pbase <- function() 103
sp_helper <- function() 104
sp_nothere <- function() 105
