# super and private bound by the function itself get no special binding.
SpShadow <- R6::R6Class("SpShadow",
  inherit = SpBase,
  public = list(
    sp_param_super = function(super) super$sp_deep(),
    sp_param_private = function(private) private$sp_helper(),
    sp_rebound_super = function() {
      super <- list(sp_deep = function() 0)
      super$sp_deep()
    },
    sp_rebound_private = function() {
      private <- NULL
      private$sp_helper()
    },
    sp_loop_super = function(xs) {
      for (super in xs) super$sp_deep()
    },
    sp_closure_super = function() {
      f <- function() super$sp_deep()
      f()
    }
  ),
  private = list(
    sp_helper = function() 7
  )
)
