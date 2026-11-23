# The child: super$ and private$ calls of every shape.
SpChild <- R6::R6Class("SpChild",
  inherit = SpMid,
  public = list(
    initialize = function() super$initialize(),
    sp_run_hello = function() super$sp_hello(),
    sp_run_deep = function() super$sp_deep(),
    sp_run_pbase = function() super$sp_pbase(),
    sp_run_helper = function() private$sp_helper(),
    sp_run_pbase_private = function() private$sp_pbase(),
    sp_run_super_missing = function() super$sp_nothere(),
    sp_run_private_missing = function() private$sp_nothere(),
    sp_run_self_helper = function() self$sp_helper()
  ),
  private = list(
    sp_helper = function() 5,
    sp_private_chain = function() private$sp_helper()
  )
)
