cross_default <- function(v) v %||% 0

cross_glue <- function(a, b) a %+% b

chained <- function(a, b) a %||% b %||% 1

# Base operators and operators that the repository does not define bind nothing.
base_ops <- function(a, b) {
  c(a %in% b, a %o% b, a %*% b, a %% b, a %/% b)
}

magrittr_pipe <- function(x) x %>% sum()
