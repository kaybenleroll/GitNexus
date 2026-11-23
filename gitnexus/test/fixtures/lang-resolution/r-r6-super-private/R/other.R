# Another class with a private method of the same name as SpChild's: private$ never reaches it.
SpOther <- R6::R6Class("SpOther",
  public = list(
    sp_other_run = function() private$sp_helper()
  ),
  private = list(
    sp_helper = function() 6
  )
)
# Unindexed parent: nothing to walk.
SpOrphan <- R6::R6Class("SpOrphan",
  inherit = pkg::Missing,
  public = list(
    sp_orphan_run = function() super$sp_deep()
  )
)
# A class with no parent: super is unbound.
SpRoot <- R6::R6Class("SpRoot",
  public = list(
    sp_root_run = function() super$sp_deep()
  )
)
