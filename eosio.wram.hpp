#pragma once

#include <eosio/eosio.hpp>
#include <eosio.system/eosio.system.hpp>
#include <eosio/singleton.hpp>

using namespace std;

namespace eosio {
   /**
    * The `eosio.wram` contract is a contract that allows to wrap & unwrap system RAM at 1:1 using the `ramtransfer` method.
    */
   class [[eosio::contract("eosio.wram")]] wram : public contract {
      const symbol RAM_SYMBOL = symbol("WRAM", 0);
      const name RAM_BANK = "ramdeposit11"_n;

      public:
         using contract::contract;

         /**
          * ## TABLE `config`
          *
          * > configuration settings for the contract, specifically related to RAM management operations
          *
          * ### params
          *
          * - `{bool} wrap_ram_enabled` - whether wrapping RAM is enabled (Only limited to converting from ram to wram, not limiting eos to wram)
          * - `{bool} unwrap_ram_enabled` - whether unwrapping RAM is enabled
          *
          * ### example
          *
          * ```json
          * {
          *     "wrap_ram_enabled": false,
          *     "unwrap_ram_enabled": false
          * }
          * ```
          */
         struct [[eosio::table("config")]] config_row {
            bool     wrap_ram_enabled = true;
            bool     unwrap_ram_enabled = false;
         };
         typedef eosio::singleton<"config"_n, config_row> config_table;

         /**
          * ## TABLE `egresslist`
          *
          * > block transfers to any account in the egress list
          *
          * ### params
          *
          * - `{name} account` - egress account not allowed to receive tokens
          *
          * ### example
          *
          * ```json
          * {
          *     "account": "eosio.ram"
          * }
          * ```
          */
         struct [[eosio::table("egresslist")]] egresslist_row {
            name     account;

            uint64_t primary_key()const { return account.value; }
         };
         typedef eosio::multi_index< "egresslist"_n, egresslist_row > egresslist;

         /**
         * Configure wrap/unwrap ram status.
         *
         * @param wrap_ram_enabled  Enable or disable wrap ram(Only limited to converting from ram to wram, not limiting eos to wram)
         * @param unwrap_ram_enabled  Enable or disable unwrap ram
         */
         [[eosio::action]]
         void cfg( const bool wrap_ram_enabled, const bool unwrap_ram_enabled );

         /**
          * Add accounts to the egress list.
          *
          * @param accounts - set of accounts to add to the egress list
          */
         [[eosio::action]]
         void addegress( const set<name> accounts );

         /**
          * Remove accounts from the egress list.
          *
          * @param accounts - set of accounts to remove from the egress list
          */
         [[eosio::action]]
         void removeegress( const set<name> accounts );

         /**
          * Unwrap WRAM tokens to system RAM `bytes`
          *
          * @param owner - the account to unwrap WRAM tokens from,
          * @param bytes - the amount of system RAM to unwrap.
          */
         [[eosio::action]]
         void unwrap( const name owner, const int64_t bytes );

         /**
          * Send system RAM `bytes` to contract to issue `RAM` tokens to sender.
          */
         [[eosio::on_notify("eosio::ramtransfer")]]
         void on_ramtransfer(const name from, const name to, const int64_t bytes, const string memo);

         /**
          * Buy system RAM `bytes` to contract to issue `RAM` tokens to payer.
          */
         [[eosio::on_notify("eosio::logbuyram")]]
         void on_logbuyram( const name& payer, const name& receiver, const asset& quantity, int64_t bytes, int64_t ram_bytes );

         /**
          * Disallow sending tokens to this contract.
          */
         [[eosio::on_notify("*::transfer")]]
         void on_transfer(const name from, const name to, const asset quantity, const string memo);

         /**
          * Allows `issuer` account to create a token in supply of `maximum_supply`. If validation is successful a new entry in statstable for token symbol scope gets created.
          *
          * @param issuer - the account that creates the token,
          * @param maximum_supply - the maximum supply set for the token created.
          *
          * @pre Token symbol has to be valid,
          * @pre Token symbol must not be already created,
          * @pre maximum_supply has to be smaller than the maximum supply allowed by the system: 1^62 - 1.
          * @pre Maximum supply must be positive;
          */
         [[eosio::action]]
         void create( const name&   issuer,
                      const asset&  maximum_supply);
         /**
          *  This action issues to `to` account a `quantity` of tokens.
          *
          * @param to - the account to issue tokens to, it must be the same as the issuer,
          * @param quantity - the amount of tokens to be issued,
          * @memo - the memo string that accompanies the token issue transaction.
          */
         [[eosio::action]]
         void issue( const name& to, const asset& quantity, const string& memo );

         /**
          * The opposite for create action, if all validations succeed,
          * it debits the statstable.supply amount.
          *
          * @param quantity - the quantity of tokens to retire,
          * @param memo - the memo string to accompany the transaction.
          */
         [[eosio::action]]
         void retire( const asset& quantity, const string& memo );

         /**
          * Allows `from` account to transfer to `to` account the `quantity` tokens.
          * One account is debited and the other is credited with quantity tokens.
          *
          * @param from - the account to transfer from,
          * @param to - the account to be transferred to,
          * @param quantity - the quantity of tokens to be transferred,
          * @param memo - the memo string to accompany the transaction.
          */
         [[eosio::action]]
         void transfer( const name&    from,
                        const name&    to,
                        const asset&   quantity,
                        const string&  memo );
         /**
          * Allows `ram_payer` to create an account `owner` with zero balance for
          * token `symbol` at the expense of `ram_payer`.
          *
          * @param owner - the account to be created,
          * @param symbol - the token to be payed with by `ram_payer`,
          * @param ram_payer - the account that supports the cost of this action.
          *
          * More information can be read [here](https://github.com/EOSIO/eosio.contracts/issues/62)
          * and [here](https://github.com/EOSIO/eosio.contracts/issues/61).
          */
         [[eosio::action]]
         void open( const name& owner, const symbol& symbol, const name& ram_payer );

         /**
          * This action is the opposite for open, it closes the account `owner`
          * for token `symbol`.
          *
          * @param owner - the owner account to execute the close action for,
          * @param symbol - the symbol of the token to execute the close action for.
          *
          * @pre The pair of owner plus symbol has to exist otherwise no action is executed,
          * @pre If the pair of owner plus symbol exists, the balance has to be zero.
          */
         [[eosio::action]]
         void close( const name& owner, const symbol& symbol );

         /**
          * The migration logic is as follows:
          * 1. Retire the wram of eosio.wram so that the liquidity and issuance are equal
          * 2. Modify the max_supply to 256G
          * 3. Migrate all ram to ram_bank
          * 4. Mint 128G wram to ram_bank 
          */
         [[eosio::action]]
         void migrate();

         static asset get_supply( const name& token_contract_account, const symbol_code& sym_code )
         {
            stats statstable( token_contract_account, sym_code.raw() );
            const auto& st = statstable.get( sym_code.raw(), "invalid supply symbol code" );
            return st.supply;
         }

         static asset get_balance( const name& token_contract_account, const name& owner, const symbol_code& sym_code )
         {
            accounts accountstable( token_contract_account, owner.value );
            const auto& ac = accountstable.get( sym_code.raw(), "no balance with specified symbol" );
            return ac.balance;
         }

         using create_action = eosio::action_wrapper<"create"_n, &wram::create>;
         using issue_action = eosio::action_wrapper<"issue"_n, &wram::issue>;
         using retire_action = eosio::action_wrapper<"retire"_n, &wram::retire>;
         using transfer_action = eosio::action_wrapper<"transfer"_n, &wram::transfer>;
         using open_action = eosio::action_wrapper<"open"_n, &wram::open>;
         using close_action = eosio::action_wrapper<"close"_n, &wram::close>;
      private:
         struct [[eosio::table]] account {
            asset    balance;

            uint64_t primary_key()const { return balance.symbol.code().raw(); }
         };

         struct [[eosio::table]] currency_stats {
            asset    supply;
            asset    max_supply;
            name     issuer;

            uint64_t primary_key()const { return supply.symbol.code().raw(); }
         };

         typedef eosio::multi_index< "accounts"_n, account > accounts;
         typedef eosio::multi_index< "stat"_n, currency_stats > stats;

         void unwrap_ram( const name to, const asset quantity );
         void wrap_ram( const name to, const int64_t bytes );
         void check_disable_transfer( const name receiver );

         void sub_balance( const name& owner, const asset& value );
         void add_balance( const name& owner, const asset& value, const name& ram_payer );
   };
} /// namespace eosio
