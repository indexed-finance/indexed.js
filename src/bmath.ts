import { BigNumber, BigNumberish } from './utils/bignumber';

export const BONE = new BigNumber(10).pow(18);
export const TWOBONE = BONE.times(new BigNumber(2));
const BPOW_PRECISION = BONE.idiv(new BigNumber(10).pow(10));

export const MAX_IN_RATIO = BONE.times(new BigNumber(0.499999999999999)); // Leave some room for bignumber rounding errors
export const MAX_OUT_RATIO = BONE.times(new BigNumber(0.333333333333333)); // Leave some room for bignumber rounding errors
export const MIN_WEIGHT = BONE.div(4);

export function scale(input: BigNumber, decimalPlaces: number): BigNumber {
  const scalePow = new BigNumber(decimalPlaces.toString());
  const scaleMul = new BigNumber(10).pow(scalePow);
  return input.times(scaleMul);
}

export function bnum(val: BigNumberish): BigNumber {
  return new BigNumber(val.toString());
}

export function calcOutGivenIn(
  tokenBalanceIn: BigNumber,
  tokenWeightIn: BigNumber,
  tokenBalanceOut: BigNumber,
  tokenWeightOut: BigNumber,
  tokenAmountIn: BigNumber,
  swapFee: BigNumber
): BigNumber {
  let weightRatio = bdiv(tokenWeightIn, tokenWeightOut);
  let adjustedIn = BONE.minus(swapFee);
  adjustedIn = bmul(tokenAmountIn, adjustedIn);
  let y = bdiv(tokenBalanceIn, tokenBalanceIn.plus(adjustedIn));
  let foo = bpow(y, weightRatio);
  let bar = BONE.minus(foo);
  let tokenAmountOut = bmul(tokenBalanceOut, bar);
  return tokenAmountOut;
}

export function calcInGivenOut(
  tokenBalanceIn: BigNumber,
  tokenWeightIn: BigNumber,
  tokenBalanceOut: BigNumber,
  tokenWeightOut: BigNumber,
  tokenAmountOut: BigNumber,
  swapFee: BigNumber
) {
  let weightRatio = bdiv(tokenWeightOut, tokenWeightIn);
  let diff = tokenBalanceOut.minus(tokenAmountOut);
  let y = bdiv(tokenBalanceOut, diff);
  let foo = bpow(y, weightRatio);
  foo = foo.minus(BONE);
  let tokenAmountIn = BONE.minus(swapFee);
  tokenAmountIn = bdiv(bmul(tokenBalanceIn, foo), tokenAmountIn);
  return tokenAmountIn;
}

export function calcSpotPrice(
  tokenBalanceIn: BigNumber,
  tokenWeightIn: BigNumber,
  tokenBalanceOut: BigNumber,
  tokenWeightOut: BigNumber,
  swapFee: BigNumber
) {
  const numer = bdiv(tokenBalanceIn, tokenWeightIn);
  const denom = bdiv(tokenBalanceOut, tokenWeightOut);
  const ratio = bdiv(numer, denom);
  const scale = bdiv(BONE, bsubSign(BONE, swapFee).res);
  return bmul(ratio, scale);
}

export function calcAllInGivenPoolOut(
  tokenBalances: BigNumber[],
  poolSupply: BigNumber,
  poolAmountOut: BigNumber
) {
  const ratio = bdiv(poolAmountOut, poolSupply);
  const amountsIn: BigNumber[] = [];
  for (let i = 0; i < tokenBalances.length; i++) {
    const balance = tokenBalances[i];
    amountsIn.push(bmul(ratio, balance));
  }
  return amountsIn;
}

export function calcPoolOutGivenSingleIn(
  tokenBalanceIn: BigNumber,
  tokenWeightIn: BigNumber,
  poolSupply: BigNumber,
  totalWeight: BigNumber,
  tokenAmountIn: BigNumber,
  swapFee: BigNumber
): BigNumber {
  const normalizedWeight = bdiv(tokenWeightIn, totalWeight);
  const zaz = bmul(BONE.minus(normalizedWeight), swapFee);
  const tokenAmountInAfterFee = bmul(tokenAmountIn, BONE.minus(zaz));

  const newTokenBalanceIn = tokenBalanceIn.plus(tokenAmountInAfterFee);
  const tokenInRatio = bdiv(newTokenBalanceIn, tokenBalanceIn);

  const poolRatio = bpow(tokenInRatio, normalizedWeight);
  const newPoolSupply = bmul(poolRatio, poolSupply);
  const poolAmountOut = newPoolSupply.minus(poolSupply);
  return poolAmountOut;
}

export function calcPoolInGivenSingleOut(
  tokenBalanceOut: BigNumber,
  tokenWeightOut: BigNumber,
  poolSupply: BigNumber,
  totalWeight: BigNumber,
  tokenAmountOut: BigNumber,
  swapFee: BigNumber,
  EXIT_FEE: BigNumber
): BigNumber {
  const normalizedWeight = bdiv(tokenWeightOut, totalWeight);
  const zoo = BONE.minus(normalizedWeight);
  const zar = bmul(zoo, swapFee);
  const tokenAmountOutBeforeSwapFee = bdiv(tokenAmountOut, BONE.minus(zar));

  const newTokenBalanceOut = tokenBalanceOut.minus(
      tokenAmountOutBeforeSwapFee
  );
  const tokenOutRatio = bdiv(newTokenBalanceOut, tokenBalanceOut);

  const poolRatio = bpow(tokenOutRatio, normalizedWeight);
  const newPoolSupply = bmul(poolRatio, poolSupply);
  const poolAmountInAfterExitFee = poolSupply.minus(newPoolSupply);

  const poolAmountIn = bdiv(poolAmountInAfterExitFee, BONE.minus(EXIT_FEE));
  return poolAmountIn;
}

export function calcAllOutGivenPoolIn(
  tokenBalances: BigNumber[],
  tokenDenorms: BigNumber[],
  poolSupply: BigNumber,
  poolAmountIn: BigNumber,
  EXIT_FEE: BigNumber
) {
  const exitFee = bmul(poolAmountIn, EXIT_FEE);
  const pAiAfterExitFee = poolAmountIn.minus(exitFee);
  const ratio = bdiv(pAiAfterExitFee, poolSupply);
  const amountsOut: BigNumber[] = [];
  for (let i = 0; i < tokenDenorms.length; i++) {
    const balance = tokenBalances[i];
    const denorm = tokenDenorms[i];
    if (denorm.eq(0)) {
      amountsOut.push(bnum(0));
    } else {
      amountsOut.push(bmul(ratio, balance));
    }
  }
  return amountsOut;
}

export function calcSingleInGivenPoolOut(
  tokenBalanceIn: BigNumber,
  tokenWeightIn: BigNumber,
  poolSupply: BigNumber,
  totalWeight: BigNumber,
  poolAmountOut: BigNumber,
  swapFee: BigNumber
): BigNumber {
  const normalizedWeight = bdiv(tokenWeightIn, totalWeight);
  const newPoolSupply = poolSupply.plus(poolAmountOut);
  const poolRatio = bdiv(newPoolSupply, poolSupply);

  const boo = bdiv(BONE, normalizedWeight);
  const tokenInRatio = bpow(poolRatio, boo);
  const newTokenBalanceIn = bmul(tokenInRatio, tokenBalanceIn);
  const tokenAmountInAfterFee = newTokenBalanceIn.minus(tokenBalanceIn);

  const zar = bmul(BONE.minus(normalizedWeight), swapFee);
  const tokenAmountIn = bdiv(tokenAmountInAfterFee, BONE.minus(zar));
  return tokenAmountIn;
}

export function calcSingleOutGivenPoolIn(
  tokenBalanceOut: BigNumber,
  tokenWeightOut: BigNumber,
  poolSupply: BigNumber,
  totalWeight: BigNumber,
  poolAmountIn: BigNumber,
  swapFee: BigNumber,
  EXIT_FEE: BigNumber
): BigNumber {
  const normalizedWeight = bdiv(tokenWeightOut, totalWeight);
  const poolAmountInAfterExitFee = bmul(poolAmountIn, BONE.minus(EXIT_FEE));
  const newPoolSupply = poolSupply.minus(poolAmountInAfterExitFee);
  const poolRatio = bdiv(newPoolSupply, poolSupply);

  const tokenOutRatio = bpow(poolRatio, bdiv(BONE, normalizedWeight));
  const newTokenBalanceOut = bmul(tokenOutRatio, tokenBalanceOut);

  const tokenAmountOutBeforeSwapFee = tokenBalanceOut.minus(
      newTokenBalanceOut
  );

  const zaz = bmul(BONE.minus(normalizedWeight), swapFee);
  const tokenAmountOut = bmul(tokenAmountOutBeforeSwapFee, BONE.minus(zaz));
  return tokenAmountOut;
}

export function calcInGivenPrice(
  tokenBalanceIn: BigNumber,
  tokenWeightIn: BigNumber,
  tokenBalanceOut: BigNumber,
  tokenWeightOut: BigNumber,
  externalPrice: BigNumber,
  swapFee: BigNumber
) {
  const marketPrice = calcSpotPrice(
    tokenBalanceIn, tokenWeightIn, tokenBalanceOut, tokenWeightOut, swapFee
  );
  const priceRatio = bdiv(externalPrice, marketPrice).div(BONE);
  const weightSum = tokenWeightOut.plus(tokenWeightIn);
  const weightExp = tokenWeightOut.div(weightSum);
  const foo = priceRatio.toNumber() ** weightExp.toNumber();
  const bar = foo - 1;
  const tokenAmountIn = tokenBalanceIn.times(bar);
  return tokenAmountIn;
}

export function bmul(a: BigNumber, b: BigNumber): BigNumber {
  let c0 = a.times(b);
  let c1 = c0.plus(BONE.div(new BigNumber(2)));
  let c2 = c1.idiv(BONE);
  return c2.integerValue();
}

export function bdiv(a: BigNumber, b: BigNumber): BigNumber {
  let c0 = a.times(BONE);
  let c1 = c0.plus(b.div(new BigNumber(2)));
  let c2 = c1.idiv(b);
  return c2;
}

export function btoi(a: BigNumber): BigNumber {
  return a.idiv(BONE);
}

export function bfloor(a: BigNumber): BigNumber {
  return btoi(a).times(BONE);
}

export function bsubSign(
  a: BigNumber,
  b: BigNumber
): { res: BigNumber; bool: boolean } {
  if (a.gte(b)) {
    let res = a.minus(b);
    let bool = false;
    return { res, bool };
  } else {
    let res = b.minus(a);
    let bool = true;
    return { res, bool };
  }
}

function bpowi(a: BigNumber, n: BigNumber): BigNumber {
  let z = !n.modulo(new BigNumber(2)).eq(new BigNumber(0)) ? a : BONE;

  for (
    n = n.idiv(new BigNumber(2));
    !n.eq(new BigNumber(0));
    n = n.idiv(new BigNumber(2))
  ) {
    a = bmul(a, a);
    if (!n.modulo(new BigNumber(2)).eq(new BigNumber(0))) {
      z = bmul(z, a);
    }
  }
  return z;
}

export function bpow(base: BigNumber, exp: BigNumber): BigNumber {
  let whole = bfloor(exp);
  let remain = exp.minus(whole);
  let wholePow = bpowi(base, btoi(whole));
  if (remain.eq(new BigNumber(0))) {
    return wholePow;
  }

  let partialResult = bpowApprox(base, remain, BPOW_PRECISION);
  return bmul(wholePow, partialResult);
}

function bpowApprox(
  base: BigNumber,
  exp: BigNumber,
  precision: BigNumber
): BigNumber {
  let a = exp;
  let { res: x, bool: xneg } = bsubSign(base, BONE);
  let term = BONE;
  let sum = term;
  let negative = false;

  for (let i = 1; term.gte(precision); i++) {
    let bigK = new BigNumber(i).times(BONE);
    let { res: c, bool: cneg } = bsubSign(a, bigK.minus(BONE));
    term = bmul(term, bmul(c, x));
    term = bdiv(term, bigK);
    if (term.eq(new BigNumber(0))) break;

    if (xneg) negative = !negative;
    if (cneg) negative = !negative;
    if (negative) {
      sum = sum.minus(term);
    } else {
      sum = sum.plus(term);
    }
  }

  return sum;
}
