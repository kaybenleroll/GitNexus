# One function per pipe shape so each assertion is an exact set.
paren_user <- function(x) {
  x %>% f()
}

bare_user <- function(x) {
  x %>% f
}

chain_user <- function(x) {
  x %>% g() %>% f()
}

assign_user <- function(x) {
  x %<>% f()
}

tee_user <- function(x) {
  x %T>% f()
}

expose_user <- function(x) {
  x %$% f(a)
}

native_user <- function(x) {
  x |> f()
}

base_user <- function(x) {
  paste(x)
}

# Same-file definition, to separate the local-call tier from the cross-file name fallback.
local_f <- function(d) d

local_user <- function(x) {
  x %>% local_f()
}

local_bare_user <- function(x) {
  x %>% local_f
}

# Bare stages: an identifier after a pipe is a call of that function.
bare_chain_user <- function(x) {
  x %>% g %>% f
}

bare_mixed_user <- function(x) {
  x %>% g() %>% f
}

bare_assign_user <- function(x) {
  x %<>% f
}

bare_tee_user <- function(x) {
  x %T>% f
}

bare_expose_user <- function(x) {
  x %$% f
}

# A non-pipe infix operator does not call its right-hand side.
in_user <- function(x) {
  x %in% f
}

# A stage that is not a plain identifier gains nothing from the bare-stage pattern.
member_stage_user <- function(x) {
  x %>% pkg$f
}
