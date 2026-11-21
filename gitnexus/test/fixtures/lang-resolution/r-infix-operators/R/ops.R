`%||%` <- function(x, y) if (is.null(x)) y else x

`%+%` = function(a, b) paste0(a, b)

local_default <- function(v) v %||% "none"

local_glue <- function(a, b) a %+% b
