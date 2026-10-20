alter table apxgen_provider_config add (
  total_limit_usd number default 1 not null check(total_limit_usd between 0 and 100)
);
