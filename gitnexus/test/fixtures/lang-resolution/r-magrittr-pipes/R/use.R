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
