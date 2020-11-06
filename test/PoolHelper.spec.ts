import { expect } from 'chai';
import { provider, createPool, TestToken } from './setup';
import { PoolHelper } from '../src/pool-helper';
import { InitializedPool } from '../src/types';
import { formatBalance, toWei } from '../src/utils/bignumber';
import { calcAllInGivenPoolOut, calcAllOutGivenPoolIn, calcSingleOutGivenPoolIn, bnum, calcPoolInGivenSingleOut } from '../src/bmath';

describe('PoolHelper', async () => {
  let pool, tokens: TestToken[], poolInfo: InitializedPool;
  let helper: PoolHelper;
  let from;

  before(async () => {
    ({ pool, tokens, poolInfo, from } = await createPool());
    helper = await new PoolHelper(provider as any, poolInfo);
  });

  it('gets pool data', async () => {
    await helper.waitForUpdate;
    expect(helper.pool.totalSupply).to.eq(poolInfo.totalSupply);
    expect(helper.pool.totalWeight).to.eq(poolInfo.totalWeight);
    expect(helper.pool.maxTotalSupply).to.eq(poolInfo.maxTotalSupply);
    expect(helper.pool.swapFee).to.eq(poolInfo.swapFee);
    for (let token of tokens) {
      const res = helper.getTokenBySymbol(token.symbol);
      expect(res.address).to.eq(token.address);
      expect(res.name).to.eq(token.name);
      expect(res.symbol).to.eq(token.symbol);
      expect(res.balance.eq(token.balance)).to.be.true;
      expect(res.usedBalance.eq(token.balance)).to.be.true;
      expect(res.denorm.eq(token.denorm)).to.be.true;
      expect(res.usedDenorm.eq(token.denorm)).to.be.true;
      expect(res.desiredDenorm.eq(token.denorm)).to.be.true;
      expect(res.weight.eq(token.weight)).to.be.true;
      expect(res.usedWeight.eq(token.weight)).to.be.true;
      expect(res.desiredWeight.eq(token.weight)).to.be.true;
    }
  });

  it('calcPoolOutGivenSingleIn()', async () => {
    const maximumAmountIn = toWei(10000);
    const poolAmountOut = toWei(1);
    for (let token of tokens) {
      await token.token.methods.getFreeTokens(from, maximumAmountIn).send({ from });
      await token.token.methods.approve(poolInfo.address, maximumAmountIn).send({ from });
      const amountInExpected = await pool.methods.joinswapExternAmountIn(token.address, poolAmountOut, 0).call();
      const { amount, decimals, displayAmount, symbol } = await helper.calcPoolOutGivenSingleIn(token.address, poolAmountOut);
      expect(symbol).to.eq(token.symbol);
      expect(decimals).to.eq(18);
      expect(amount).to.eq('0x' + bnum(amountInExpected).toString(16))
      expect(displayAmount).to.eq(formatBalance(bnum(amount), 18, 4));
    }
  });

  it('calcSingleInGivenPoolOut()', async () => {
    const maximumAmountIn = toWei(10000);
    const tokenAmountIn = toWei(1);
    for (let token of tokens) {
      await token.token.methods.getFreeTokens(from, maximumAmountIn).send({ from });
      await token.token.methods.approve(poolInfo.address, maximumAmountIn).send({ from });
      const amountInExpected = await pool.methods.joinswapPoolAmountOut(token.address, tokenAmountIn, maximumAmountIn).call();
      const { amount, decimals, displayAmount, symbol } = await helper.calcSingleInGivenPoolOut(token.address, tokenAmountIn);
      expect(symbol).to.eq(token.symbol);
      expect(decimals).to.eq(18);
      expect(amount).to.eq('0x' + bnum(amountInExpected).toString(16))
      expect(displayAmount).to.eq(formatBalance(bnum(amount), 18, 4));
    }
  });

  it('calcAllInGivenPoolOut()', async () => {
    const poolAmountOut = toWei(1);
    const usedBalances = tokens.map(t => t.balance);
    const expectAmountsIn = calcAllInGivenPoolOut(usedBalances, toWei(100), poolAmountOut);
    const amountsIn = await helper.calcAllInGivenPoolOut(poolAmountOut);
    amountsIn.forEach(({ amount, symbol, displayAmount, decimals }, i) => {
      const token = tokens[i];
      expect(symbol).to.eq(token.symbol);
      expect(decimals).to.eq(18);
      const expected = expectAmountsIn[i];
      expect(amount).to.eq('0x' + expected.toString(16))
      expect(displayAmount).to.eq(formatBalance(bnum(amount), 18, 4));
    });
  });

  it('calcSingleOutGivenPoolIn()', async () => {
    const poolAmountIn = toWei(1);
    for (let token of tokens) {
      const amountOutExpected = calcSingleOutGivenPoolIn(
        token.balance,
        token.denorm,
        poolInfo.totalSupply,
        poolInfo.totalWeight,
        poolAmountIn,
        poolInfo.swapFee
      );
      const { amount, decimals, displayAmount, symbol } = await helper.calcSingleOutGivenPoolIn(token.address, poolAmountIn);
      expect(symbol).to.eq(token.symbol);
      expect(decimals).to.eq(18);
      expect(amount).to.eq('0x' + amountOutExpected.toString(16))
      expect(displayAmount).to.eq(formatBalance(bnum(amount), 18, 4));
    }
  });

  it('calcPoolInGivenSingleOut()', async () => {
    const tokenAmountOut = toWei(1);
    for (let token of tokens) {
      const amountInExpected = calcPoolInGivenSingleOut(
        token.balance,
        token.denorm,
        poolInfo.totalSupply,
        poolInfo.totalWeight,
        tokenAmountOut,
        poolInfo.swapFee
      );
      const { amount, decimals, displayAmount, symbol } = await helper.calcPoolInGivenSingleOut(token.address, tokenAmountOut);
      expect(symbol).to.eq(token.symbol);
      expect(decimals).to.eq(18);
      expect(amount).to.eq('0x' + amountInExpected.toString(16))
      expect(displayAmount).to.eq(formatBalance(bnum(amount), 18, 4));
    }
  });

  it('calcAllOutGivenPoolIn()', async () => {
    const poolAmountIn = toWei(1);
    const expectedAmountsOut = calcAllOutGivenPoolIn(
      tokens.map(t => t.balance),
      tokens.map(t => t.denorm),
      poolInfo.totalSupply,
      poolAmountIn
    );
    const amountsOut = await helper.calcAllOutGivenPoolIn(poolAmountIn);
    amountsOut.forEach(({ amount, symbol, displayAmount, decimals }, i) => {
      const token = tokens[i];
      expect(symbol).to.eq(token.symbol);
      expect(decimals).to.eq(18);
      const expected = expectedAmountsOut[i];
      expect(amount).to.eq('0x' + expected.toString(16));
      expect(displayAmount).to.eq(formatBalance(bnum(amount), 18, 4));
    });
  });
});