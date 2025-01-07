import { Asset, Int64, Name } from '@wharfkit/antelope'
import { AccountPermission, Blockchain, expectToThrow } from '@eosnetwork/vert'
import { Name as Ne, Authority, PermissionLevel } from '@greymass/eosio'
import { describe, expect, test } from 'bun:test'

// Vert EOS VM
const blockchain = new Blockchain()
const alice = 'alice'
const bob = 'bob'
const charles = 'charles'
const ram_bank = 'ramdeposit11'
const egress_list = ['eosio.ram']
const RAM_SYMBOL = 'WRAM'
blockchain.createAccounts(bob, alice, charles, ram_bank, ...egress_list)

const wram_contract = 'eosio.wram'
const contracts = {
    wram: blockchain.createContract(wram_contract, wram_contract, true),
    token: blockchain.createContract('eosio.token', 'external/eosio.token/eosio.token', true),
    system: blockchain.createContract('eosio', 'external/eosio.system/eosio', true),
    fake: {
        token: blockchain.createContract('fake.token', 'external/eosio.token/eosio.token', true),
        system: blockchain.createContract('fake', 'external/eosio.system/eosio', true),
    },
}

blockchain.getAccount(Ne.from(ram_bank))?.setPermissions([
    AccountPermission.from({
        perm_name: Ne.from('active'),
        parent: Ne.from('owner'),
        required_auth: Authority.from({
            threshold: 1,
            accounts: [
                {
                    weight: 1,
                    permission: PermissionLevel.from('eosio.wram@eosio.code'),
                },
            ],
        }),
    }),
])

interface Config {
    wrap_ram_enabled: boolean
    unwrap_ram_enabled: boolean
}

function getConfig(): Config {
    return contracts.wram.tables.config().getTableRows()[0]
}

function getTokenBalance(account: string, symcode: string) {
    const scope = Name.from(account).value.value
    const primary_key = Asset.SymbolCode.from(symcode).value.value
    const row = contracts.wram.tables.accounts(scope).getTableRow(primary_key)
    if (!row) return 0
    return Asset.from(row.balance).units.toNumber()
}

function getTokenSupply(symcode: string) {
    const scope = Asset.SymbolCode.from(symcode).value.value
    const row = contracts.wram.tables.stat(scope).getTableRow(scope)
    if (!row) return 0
    return Asset.from(row.supply).units.toNumber()
}

function getRamBytes(account: string) {
    const scope = Name.from(account).value.value
    const row = contracts.system.tables.userres(scope).getTableRow(scope)
    if (!row) return 0
    return Int64.from(row.ram_bytes).toNumber()
}

function getEgressList(account: string) {
    const primary_key = Name.from(account).value.value
    const row = contracts.wram.tables.egresslist(Name.from(wram_contract).value.value).getTableRow(primary_key)
    if (!row) return ''
    return Name.from(row.account).toString()
}

describe(wram_contract, () => {
    test('eosio::init', async () => {
        await contracts.system.actions.init([]).send()
        await contracts.wram.actions.cfg([true, true]).send()
    })

    test('eosio.token::issue::EOS', async () => {
        const supply = `1000000000.0000 EOS`
        await contracts.token.actions.create(['eosio.token', supply]).send()
        await contracts.token.actions.issue(['eosio.token', supply, '']).send()
        await contracts.token.actions.transfer(['eosio.token', alice, '1000.0000 EOS', '']).send()
        await contracts.token.actions.transfer(['eosio.token', bob, '1000.0000 EOS', '']).send()
        await contracts.token.actions.transfer(['eosio.token', charles, '1000.0000 EOS', '']).send()
    })

    test('eosio.warm::create::error - mismatch WRAM symbol', async () => {
        const supply = `418945440768 FOOBAR`
        const action = contracts.wram.actions.create([wram_contract, supply]).send()
        await expectToThrow(action, 'eosio_assert: symbol must be WRAM')
    })

    test('eosio.wram::create::WRAM', async () => {
        const supply = `418945440768 ${RAM_SYMBOL}`
        await contracts.wram.actions.create([wram_contract, supply]).send()
        expect(getTokenBalance(wram_contract, RAM_SYMBOL)).toBe(0)
    })

    test('eosio::buyrambytes', async () => {
        const before = getRamBytes(alice)
        await contracts.system.actions.buyrambytes([alice, alice, 10000]).send() // doesn't trigger mirror system RAM
        const after = getRamBytes(alice)
        expect(after - before).toBe(10000)
    })

    test('wrapram buyrambytes', async () => {
        const before = getTokenSupply(RAM_SYMBOL)
        await contracts.system.actions.buyrambytes([alice, wram_contract, 100]).send()
        const after = getTokenSupply(RAM_SYMBOL)
        expect(after - before).toBe(100)
    })

    test('eosio::ramtransfer', async () => {
        const before = getRamBytes(bob)
        await contracts.system.actions.ramtransfer([alice, bob, 5000, '']).send()
        const after = getRamBytes(bob)
        expect(after - before).toBe(5000)
    })

    test('fake::init', async () => {
        await contracts.fake.system.actions.init([]).send()
    })

    test('fake::buyrambytes', async () => {
        const before = getTokenBalance(wram_contract, RAM_SYMBOL)
        await contracts.fake.system.actions.buyrambytes([alice, alice, 10000]).send()
        const after = getTokenBalance(wram_contract, RAM_SYMBOL)
        expect(after - before).toBe(0)
    })

    test('fake.token::issue::WRAM', async () => {
        const supply = `10000000000000 ${RAM_SYMBOL}`
        await contracts.fake.token.actions.create(['fake.token', supply]).send()
        await contracts.fake.token.actions.issue(['fake.token', supply, '']).send()
        await contracts.fake.token.actions.transfer(['fake.token', alice, `10000000 ${RAM_SYMBOL}`, '']).send()
    })

    test('on_notify::ramtransfer - wrap RAM bytes', async () => {
        const before = {
            wram_contract: {
                bytes: getRamBytes(wram_contract),
                RAM: getTokenBalance(wram_contract, RAM_SYMBOL),
                supply: getTokenSupply(RAM_SYMBOL),
            },
            alice: {
                bytes: getRamBytes(alice),
                RAM: getTokenBalance(alice, RAM_SYMBOL),
            },
            ram_bank: {
                bytes: getRamBytes(ram_bank),
            },
        }
        await contracts.system.actions.ramtransfer([alice, wram_contract, 1000, '']).send(alice)
        const after = {
            wram_contract: {
                bytes: getRamBytes(wram_contract),
                RAM: getTokenBalance(wram_contract, RAM_SYMBOL),
                supply: getTokenSupply(RAM_SYMBOL),
            },
            alice: {
                bytes: getRamBytes(alice),
                RAM: getTokenBalance(alice, RAM_SYMBOL),
            },
            ram_bank: {
                bytes: getRamBytes(ram_bank),
            },
        }
        // bytes
        expect(after.alice.bytes - before.alice.bytes).toBe(-1000)
        expect(after.wram_contract.bytes - before.wram_contract.bytes).toBe(0)
        expect(after.ram_bank.bytes - before.ram_bank.bytes).toBe(1000)

        // RAM
        expect(after.alice.RAM - before.alice.RAM).toBe(1000)
        expect(after.wram_contract.RAM - before.wram_contract.RAM).toBe(0)
        expect(after.wram_contract.supply - before.wram_contract.supply).toBe(1000)
    })

    test('on_notify::buyrambytes - wrap RAM bytes', async () => {
        const before = {
            wram_contract: {
                bytes: getRamBytes(wram_contract),
                RAM: getTokenBalance(wram_contract, RAM_SYMBOL),
                supply: getTokenSupply(RAM_SYMBOL),
            },
            alice: {
                bytes: getRamBytes(alice),
                RAM: getTokenBalance(alice, RAM_SYMBOL),
            },
            ram_bank: {
                bytes: getRamBytes(ram_bank),
            },
        }
        await contracts.system.actions.buyrambytes([alice, wram_contract, 2000]).send(alice)
        const after = {
            wram_contract: {
                bytes: getRamBytes(wram_contract),
                RAM: getTokenBalance(wram_contract, RAM_SYMBOL),
                supply: getTokenSupply(RAM_SYMBOL),
            },
            alice: {
                bytes: getRamBytes(alice),
                RAM: getTokenBalance(alice, RAM_SYMBOL),
            },
            ram_bank: {
                bytes: getRamBytes(ram_bank),
            },
        }
        // bytes
        expect(after.alice.bytes - before.alice.bytes).toBe(0)
        expect(after.wram_contract.bytes - before.wram_contract.bytes).toBe(0)
        expect(after.ram_bank.bytes - before.ram_bank.bytes).toBe(2000)

        // RAM
        expect(after.alice.RAM - before.alice.RAM).toBe(2000)
        expect(after.wram_contract.RAM - before.wram_contract.RAM).toBe(0)
        expect(after.wram_contract.supply - before.wram_contract.supply).toBe(2000)
    })

    test('transfer - unwrap WRAM', async () => {
        const before = {
            wram_contract: {
                bytes: getRamBytes(wram_contract),
                RAM: getTokenBalance(wram_contract, RAM_SYMBOL),
                supply: getTokenSupply(RAM_SYMBOL),
            },
            alice: {
                bytes: getRamBytes(alice),
                RAM: getTokenBalance(alice, RAM_SYMBOL),
            },
            ram_bank: {
                bytes: getRamBytes(ram_bank),
            },
        }
        await contracts.wram.actions.transfer([alice, wram_contract, `500 ${RAM_SYMBOL}`, '']).send(alice)
        const after = {
            wram_contract: {
                bytes: getRamBytes(wram_contract),
                RAM: getTokenBalance(wram_contract, RAM_SYMBOL),
                supply: getTokenSupply(RAM_SYMBOL),
            },
            alice: {
                bytes: getRamBytes(alice),
                RAM: getTokenBalance(alice, RAM_SYMBOL),
            },
            ram_bank: {
                bytes: getRamBytes(ram_bank),
            },
        }
        // bytes
        expect(after.alice.bytes - before.alice.bytes).toBe(500)
        expect(after.wram_contract.bytes - before.wram_contract.bytes).toBe(0)
        expect(after.ram_bank.bytes - before.ram_bank.bytes).toBe(-500)

        // RAM
        expect(after.alice.RAM - before.alice.RAM).toBe(-500)
        expect(after.wram_contract.RAM - before.wram_contract.RAM).toBe(0)
        expect(after.wram_contract.supply - before.wram_contract.supply).toBe(-500)
    })

    test('transfer - WRAM to another account', async () => {
        const before = {
            bob: {
                bytes: getRamBytes(bob),
                RAM: getTokenBalance(bob, RAM_SYMBOL),
            },
            alice: {
                bytes: getRamBytes(alice),
                RAM: getTokenBalance(alice, RAM_SYMBOL),
            },
        }
        await contracts.wram.actions.transfer([alice, bob, `500 ${RAM_SYMBOL}`, '']).send(alice)
        const after = {
            bob: {
                bytes: getRamBytes(bob),
                RAM: getTokenBalance(bob, RAM_SYMBOL),
            },
            alice: {
                bytes: getRamBytes(alice),
                RAM: getTokenBalance(alice, RAM_SYMBOL),
            },
        }

        // bytes (no change)
        expect(after.alice.bytes - before.alice.bytes).toBe(0)
        expect(after.bob.bytes - before.bob.bytes).toBe(0)

        // RAM
        expect(after.alice.RAM - before.alice.RAM).toBe(-500)
        expect(after.bob.RAM - before.bob.RAM).toBe(+500)
    })

    test('transfer - ignore', async () => {
        const before = getTokenBalance(alice, RAM_SYMBOL)
        await contracts.system.actions.ramtransfer([alice, wram_contract, 1000, 'ignore']).send(alice)
        const after = getTokenBalance(alice, RAM_SYMBOL)
        expect(after - before).toBe(0)
    })

    test('unwrap', async () => {
        const before = {
            bytes: getRamBytes(alice),
            RAM: getTokenBalance(alice, RAM_SYMBOL),
        }
        await contracts.wram.actions.unwrap([alice, 1000]).send(alice)
        const after = {
            bytes: getRamBytes(alice),
            RAM: getTokenBalance(alice, RAM_SYMBOL),
        }
        expect(after.bytes - before.bytes).toBe(1000)
        expect(after.RAM - before.RAM).toBe(-1000)
    })

    test('egresslist - addegress', async () => {
        await contracts.wram.actions.addegress([egress_list]).send(wram_contract)
        for (const to of egress_list) {
            expect(getEgressList(to)).toBe(to)
        }
    })

    test('egresslist::transfer::error - cannot transfer to egress list', async () => {
        for (const to of egress_list) {
            const action = contracts.wram.actions.transfer([alice, to, `1000 ${RAM_SYMBOL}`, '']).send(alice)
            await expectToThrow(action, 'eosio_assert: transfer disabled to account')
        }
    })

    test('egresslist - removeegress', async () => {
        await contracts.wram.actions.removeegress([egress_list]).send(wram_contract)
        for (const to of egress_list) {
            expect(getEgressList(to)).toBe('')
        }
    })

    test('transfer::error - fake eosio.token WRAM', async () => {
        const action = contracts.fake.token.actions
            .transfer([alice, wram_contract, `1000 ${RAM_SYMBOL}`, ''])
            .send(alice)
        await expectToThrow(action, 'eosio_assert_message: only eosio.wram token transfers are allowed')
    })

    test('transfer::error - not allowed to send EOS or any eosio.token', async () => {
        const action = contracts.token.actions.transfer([alice, wram_contract, `1000.0000 EOS`, '']).send(alice)
        await expectToThrow(action, 'eosio_assert_message: only eosio.wram token transfers are allowed')
    })

    test('transfer::error - missing required authority eosio.token', async () => {
        const action = contracts.token.actions.transfer([alice, wram_contract, `1000.0000 EOS`, '']).send(bob)
        await expectToThrow(action, 'missing required authority alice')
    })

    test('transfer::error - missing required authority eosio.wram', async () => {
        const action = contracts.wram.actions.transfer([alice, wram_contract, `10 ${RAM_SYMBOL}`, '']).send(bob)
        await expectToThrow(action, 'missing required authority alice')
    })

    test('transfer::error - fake eosio system RAM bytes', async () => {
        const before = getTokenBalance(alice, RAM_SYMBOL)
        await contracts.fake.system.actions.ramtransfer([alice, wram_contract, 1000, alice]).send(alice)
        const after = getTokenBalance(alice, RAM_SYMBOL)
        expect(after - before).toBe(0)
    })

    test('ramtransfer::error - bytes must be positive', async () => {
        const action = contracts.system.actions.ramtransfer([alice, wram_contract, 0, '']).send(wram_contract)
        await expectToThrow(action, 'eosio_assert: must transfer positive quantity')
    })

    test('ramtransfer::error - cannot wrap ram to self', async () => {
        const action = contracts.system.actions.buyrambytes([wram_contract, wram_contract, 100]).send(wram_contract)
        await expectToThrow(action, 'eosio_assert: cannot wrap ram to self')
    })

    test('transfer::error - must transfer positive quantity', async () => {
        const action = contracts.wram.actions.transfer([alice, wram_contract, `0 ${RAM_SYMBOL}`, '']).send(alice)
        await expectToThrow(action, 'eosio_assert: must transfer positive quantity')
    })

    test('transfer::error - cannot transfer to self', async () => {
        const action = contracts.wram.actions
            .transfer([wram_contract, wram_contract, `0 ${RAM_SYMBOL}`, ''])
            .send(wram_contract)
        await expectToThrow(action, 'eosio_assert: cannot transfer to self')
    })

    test('issue::error - must be executed by contract', async () => {
        const action_issue = contracts.wram.actions
            .issue([wram_contract, `10000 ${RAM_SYMBOL}`, ''])
            .send(wram_contract)
        await expectToThrow(action_issue, 'eosio_assert: must be executed by contract')

        const action_retire = contracts.wram.actions.retire([`10000 ${RAM_SYMBOL}`, '']).send(wram_contract)
        await expectToThrow(action_retire, 'eosio_assert: must be executed by contract')
    })

    test('cfg::error', async () => {
        await expectToThrow(
            contracts.wram.actions.cfg([false, true]).send(bob),
            'missing required authority eosio.wram'
        )
    })

    test('wrapram::disabled - only limited to converting from ram to wram', async () => {
        await contracts.wram.actions.cfg([false, true]).send()
        expect(getConfig()).toEqual({
            wrap_ram_enabled: false,
            unwrap_ram_enabled: true,
        })

        await expectToThrow(
            contracts.system.actions.ramtransfer([alice, wram_contract, 1000, '']).send(),
            'eosio_assert: wrap ram is currently disabled'
        )

        await contracts.system.actions.buyrambytes([alice, wram_contract, 1000]).send()
        await contracts.wram.actions.unwrap([alice, 1000]).send(alice)
    })

    test('wrapram::enabled', async () => {
        await contracts.wram.actions.cfg([true, true]).send()
        expect(getConfig()).toEqual({
            wrap_ram_enabled: true,
            unwrap_ram_enabled: true,
        })
    })

    test('unwrapram::disabled', async () => {
        await contracts.system.actions.ramtransfer([alice, wram_contract, 5000, '']).send()

        await contracts.wram.actions.cfg([true, false]).send()
        expect(getConfig()).toEqual({
            wrap_ram_enabled: true,
            unwrap_ram_enabled: false,
        })

        await expectToThrow(
            contracts.wram.actions.unwrap([alice, 500]).send(alice),
            'eosio_assert: unwrap ram is currently disabled'
        )

        await expectToThrow(
            contracts.wram.actions.transfer([alice, wram_contract, `500 ${RAM_SYMBOL}`, '']).send(alice),
            'eosio_assert: unwrap ram is currently disabled'
        )

    })

    test('unwrapram::enabled', async () => {
        await contracts.wram.actions.cfg([true, true]).send()
        expect(getConfig()).toEqual({
            wrap_ram_enabled: true,
            unwrap_ram_enabled: true,
        })
    })

    test('migrate::error - missing required authority eosio.wram', async () => {
        const action = contracts.wram.actions.migrate().send(bob)
        await expectToThrow(action, 'missing required authority eosio.wram')
    })

    test('migrate', async () => {
        const before = {
            wram_contract: {
                RAM: getTokenBalance(wram_contract, RAM_SYMBOL),
                supply: getTokenSupply(RAM_SYMBOL),
                bytes: getRamBytes(wram_contract),
            },
            ram_bank: {
                bytes: getRamBytes(ram_bank),
                RAM: getTokenBalance(ram_bank, RAM_SYMBOL),
            },
        }
        await contracts.wram.actions.migrate().send()
        const after = {
            wram_contract: {
                RAM: getTokenBalance(wram_contract, RAM_SYMBOL),
                supply: getTokenSupply(RAM_SYMBOL),
                bytes: getRamBytes(wram_contract),
            },
            ram_bank: {
                bytes: getRamBytes(ram_bank),
                RAM: getTokenBalance(ram_bank, RAM_SYMBOL),
            },
        }
        // bytes
        expect(after.wram_contract.bytes - before.wram_contract.bytes).toBe(-6600)
        expect(after.ram_bank.bytes - before.ram_bank.bytes).toBe(6600)

        // RAM
        const ram_128G = 128 * 1024 * 1024 * 1024
        expect(after.ram_bank.RAM - before.ram_bank.RAM).toBe(ram_128G)
        expect(after.wram_contract.RAM - before.wram_contract.RAM).toBe(0)
        expect(after.wram_contract.supply - before.wram_contract.supply).toBe(ram_128G)
    })

    test('migrate::error - can only be executed once', async () => {
        await expectToThrow(contracts.wram.actions.migrate().send(), 'eosio_assert: can only be executed once')
    })
})
