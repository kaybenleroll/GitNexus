assist <- function(x) x + 1

run_free <- function(x) assist(x)

Foo <- R6::R6Class("Foo",
  public = list(
    run = function(x) private$helper(x)
  ),
  private = list(
    helper = function(x) x * 100
  )
)
