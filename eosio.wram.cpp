#include "eosio.wram.hpp"
#include "src/token.cpp"
#include "src/egress.cpp"
#include "src/config.cpp"

namespace eosio {

[[eosio::action]]
void wram::unwrap( const name owner, const int64_t bytes )
{
   transfer(owner, get_self(), asset{bytes, RAM_SYMBOL}, "unwrap ram");
}

void wram::unwrap_ram( const name to, const asset quantity )
{
   // validate incoming token transfer
   check(quantity.symbol == RAM_SYMBOL, "Only the system " + RAM_SYMBOL.code().to_string() + " token is accepted for transfers.");

   // check status
   config_table _config(get_self(), get_self().value);
   config_row config = _config.get_or_default();
   check(config.unwrap_ram_enabled, "unwrap ram is currently disabled");

   // retire wram
   retire_action retire_act{get_self(), {get_self(), "active"_n}};
   retire_act.send(quantity, "unwrap ram");

   // ramtransfer to user
   eosiosystem::system_contract::ramtransfer_action ramtransfer_act{"eosio"_n, {RAM_BANK, "active"_n}};
   ramtransfer_act.send(RAM_BANK, to, quantity.amount, "unwrap ram");
}

void wram::wrap_ram( const name to, const int64_t bytes )
{
   check(bytes > 0, "must transfer positive quantity");

   // cannot have contract itself mint WRAM
   check(to != get_self(), "cannot wrap ram to self" );

   const asset quantity{bytes, RAM_SYMBOL};

   // ramtransfer to rambank
   eosiosystem::system_contract::ramtransfer_action ramtransfer_act{"eosio"_n, {get_self(), "active"_n}};
   ramtransfer_act.send(get_self(), RAM_BANK, bytes, "wrap ram");

   // issue wram
   issue_action issue_act{get_self(), {get_self(), "active"_n}};
   issue_act.send(get_self(), quantity, "wrap ram");

   // transfer RAM tokens to user
   transfer_action transfer_act{get_self(), {get_self(), "active"_n}};
   transfer_act.send(get_self(), to, quantity, "wrap ram");
}

[[eosio::on_notify("eosio::logbuyram")]]
void wram::on_logbuyram( const name& payer, const name& receiver, const asset& quantity, int64_t bytes, int64_t ram_bytes )
{
   // ignore buy ram not sent to this contract
   if (receiver != get_self()) { return; }
   wrap_ram(payer, bytes);
}

// @user
[[eosio::on_notify("eosio::ramtransfer")]]
void wram::on_ramtransfer( const name from, const name to, const int64_t bytes, const string memo )
{
   // ignore transfers not sent to this contract
   if (to != get_self()) { return; }
   if (memo == "ignore") { return; } // allow for internal RAM transfers

   // check status
   config_table _config(get_self(), get_self().value);
   config_row config = _config.get_or_default();
   check(config.wrap_ram_enabled, "wrap ram is currently disabled");

   wrap_ram(from, bytes);
}

// @user
[[eosio::on_notify("*::transfer")]]
void wram::on_transfer( const name from, const name to, const asset quantity, const string memo )
{
   // ignore transfers not sent to this contract
   if (to != get_self()) { return; }

   // unwrap is triggered by internal transfer method
   check(false, "only " + get_self().to_string() + " token transfers are allowed");
}

// @self
[[eosio::action]]
void wram::migrate()
{
   require_auth(get_self());

   // Modify the max_supply to 256G
   uint64_t max_supply = 256LL * 1024 * 1024 * 1024;
   stats statstable( get_self(), RAM_SYMBOL.code().raw() );
   const auto& st = statstable.get( RAM_SYMBOL.code().raw(), "symbol does not exist" );
   check(st.max_supply.amount != max_supply, "can only be executed once");
   statstable.modify( st, same_payer, [&]( auto& s ) {
      s.max_supply.amount = max_supply;
   });
   
   // Retire the wram of eosio.wram so that the liquidity and issuance are equal
   accounts acnts( get_self(), get_self().value );
   auto acnt = acnts.require_find( RAM_SYMBOL.code().raw() );
   if(acnt->balance.amount > 0){
      retire_action retire_act{get_self(), {get_self(), "active"_n}};
      retire_act.send(acnt->balance, "retire mirror wram");
   }

   // Migrate all ram to ram_bank
   auto ram_bytes = st.supply.amount - acnt->balance.amount;
   if(ram_bytes > 0){
      eosiosystem::system_contract::ramtransfer_action ramtransfer_act{"eosio"_n, {get_self(), "active"_n}};
      ramtransfer_act.send(get_self(), RAM_BANK, ram_bytes, "migrate to rambank");
   }

   // Mint 128G wram to ram_bank 
   asset to_rams = {128LL * 1024 * 1024 * 1024, RAM_SYMBOL};
   issue_action issue_act{get_self(), {get_self(), "active"_n}};
   issue_act.send(get_self(), to_rams, "issue to rams");

   // transfer to ram_bank
   transfer_action transfer_act{get_self(), {get_self(), "active"_n}};
   transfer_act.send(get_self(), RAM_BANK, to_rams, "issue to rams");
}

} /// namespace eosio
