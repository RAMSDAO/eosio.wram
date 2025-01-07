namespace eosio {

    void wram::cfg( const bool wrap_ram_enabled, const bool unwrap_ram_enabled )
    {
        require_auth(get_self());

        config_table _config(get_self(), get_self().value);
        config_row config = _config.get_or_default();

        config.wrap_ram_enabled = wrap_ram_enabled;
        config.unwrap_ram_enabled = unwrap_ram_enabled;
        _config.set(config, get_self());
    }
}