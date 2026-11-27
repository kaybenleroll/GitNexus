# Repository definitions of operators that base R or magrittr also provide.
`%in%` <- function(x, table) TRUE

`%>%` <- function(lhs, rhs) rhs(lhs)

# Dotted operator names.
`%.%` <- function(a, b) a

`%+.%` <- function(a, b) b

# Defined by assign(): not linked.
assign("%assigned%", function(a, b) a)

# `%+%` is defined here and again in R/dup.R.
`%+%` <- function(a, b) paste0(a, b)

`%||%` <- function(x, y) if (is.null(x)) y else x

helper <- function(x) x

Counter <- R6::R6Class("Counter", public = list(
  bump = function() 1
))

local_dotted <- function(a, b) a %.% b

local_dotted_plus <- function(a, b) a %+.% b
