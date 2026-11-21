# The repository defines %in% and %>%, so these two bind.
redefined_in <- function(a, b) a %in% b

redefined_pipe <- function(x) x %>% sum()

# A call or member call on the left-hand side keeps its own edge next to the operator's.
lhs_call <- function(x) helper(x) %||% 1

lhs_member <- function(y) {
  obj <- Counter$new()
  obj$bump() %||% y
}

cross_dotted <- function(a, b) a %.% b

cross_dotted_plus <- function(a, b) a %+.% b

cross_ambiguous <- function(a, b) a %+% b

cross_assigned <- function(a, b) a %assigned% b
