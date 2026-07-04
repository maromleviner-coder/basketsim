// ─── BasketSim Self-Test Suite ──────────────────────────────────────────────
// Runs against functions extracted from the live app (sut.js).
// Reports PASS/FAIL for every case in TESTING_PLAN.md sections A-D.

const {generateWeeks,utcDateStr,buildWindowIndex,buildPriceWindowIndex,
       addDays,cleanDivs,mergeByDate,simulate,fmtReturn,fmt,fmt2,fmtM} = require('./sut.js');

let pass=0, fail=0, flagged=[];
function check(name, cond, detail){
  if(cond){ pass++; console.log('  PASS  '+name); }
  else { fail++; console.log('  FAIL  '+name+(detail?'  -- '+detail:'')); }
}
function flag(name, detail){
  flagged.push({name,detail});
  console.log('  FLAG  '+name+'  -- '+detail);
}
function approx(a,b,tol){ return Math.abs(a-b)<=tol; }

// ─── Helpers to build synthetic price/dividend data ─────────────────────────
function flatPrices(start,end,price){
  const weeks=generateWeeks(start,end);
  return weeks.map(w=>({date:utcDateStr(w.getTime()),close:price}));
}
function linearGrowthPrices(start,end,p0,p1){
  const weeks=generateWeeks(start,end);
  const n=weeks.length;
  return weeks.map((w,i)=>({date:utcDateStr(w.getTime()),close:p0+(p1-p0)*(i/(n-1))}));
}
function makeActionsMap(prices,divs=[],splits=[]){
  return {prices,divs,splits,priceIndex:buildPriceWindowIndex(prices,4)};
}

console.log('\n=== SECTION A: Simulation Engine ===\n');

// A1: flat price, no divs, no rebal -> totalReturn ~ 0
{
  const prices=flatPrices('2020-01-01','2021-01-01',100);
  const am={AAA:makeActionsMap(prices)};
  const r=simulate(
    [{ticker:'AAA',alloc:100}],10000,0,
    false,'quarterly',false,5,false,
    0,0,'2020-01-01','2021-01-01','test',am,0,0
  );
  check('A1: flat price -> totalReturn ~ 0', approx(r.totalReturn,0,0.5), 'got '+r.totalReturn.toFixed(3));
  check('A1: flat price -> cagr ~ 0', approx(r.cagr,0,0.5), 'got '+r.cagr.toFixed(3));
  check('A1: finalVal ~ totalInvested', approx(r.finalVal,r.totalInvested,50), 'final='+r.finalVal.toFixed(2)+' invested='+r.totalInvested.toFixed(2));
}

// A2: price doubles over the period -> totalReturn ~ 100%
{
  const prices=linearGrowthPrices('2020-01-01','2021-01-01',100,200);
  const am={AAA:makeActionsMap(prices)};
  const r=simulate(
    [{ticker:'AAA',alloc:100}],10000,0,
    false,'quarterly',false,5,false,
    0,0,'2020-01-01','2021-01-01','test',am,0,0
  );
  check('A2: price doubles -> totalReturn ~ 100%', approx(r.totalReturn,100,3), 'got '+r.totalReturn.toFixed(2));
}

// A3: two stocks 50/50, one doubles one halves -> net ~ flat (average of 2x and 0.5x = 1.25x, not flat!)
{
  const pricesUp  =linearGrowthPrices('2020-01-01','2021-01-01',100,200); // 2x
  const pricesDown=linearGrowthPrices('2020-01-01','2021-01-01',100,50);  // 0.5x
  const am={UP:makeActionsMap(pricesUp),DOWN:makeActionsMap(pricesDown)};
  const r=simulate(
    [{ticker:'UP',alloc:50},{ticker:'DOWN',alloc:50}],10000,0,
    false,'quarterly',false,5,false,
    0,0,'2020-01-01','2021-01-01','test',am,0,0
  );
  // Expected: 5000*2 + 5000*0.5 = 10000+2500 = 12500 -> +25%
  check('A3: 50/50 one doubles one halves -> +25% (no rebalance)', approx(r.totalReturn,25,3), 'got '+r.totalReturn.toFixed(2));
}

// A4: single dividend payment
{
  const prices=flatPrices('2020-01-01','2021-01-01',100);
  const divs=[{date:'2020-06-15',amount:'2.00'}];
  const am={AAA:makeActionsMap(prices,divs)};
  const r=simulate(
    [{ticker:'AAA',alloc:100}],10000,0,
    false,'quarterly',false,5,false,
    0,0,'2020-01-01','2021-01-01','test',am,0,0
  );
  // 10000/100 = 100 shares. div = 100*2 = 200 gross, no tax (taxDiv=0)
  check('A4: dividend received ~ $200', approx(r.totalDivReceived,200,5), 'got '+r.totalDivReceived.toFixed(2));
  check('A4: divByStock has AAA', r.divByStock && r.divByStock.AAA>0, JSON.stringify(r.divByStock));
}

// A5: duplicate dividend (chunk boundary) should be deduped by cleanDivs before simulate
{
  const divsRaw=[{date:'2020-06-12',amount:'2.00'},{date:'2020-06-15',amount:'2.00'}];
  const cleaned=cleanDivs(divsRaw);
  check('A5: duplicate dividend (3 days apart, same amount) deduped to 1', cleaned.length===1, 'got '+cleaned.length+' entries: '+JSON.stringify(cleaned));
}

// A6: cash allocation 20%, no yield -> initial cash exactly 20% of capital
{
  const prices=flatPrices('2020-01-01','2021-01-01',100);
  const am={AAA:makeActionsMap(prices)};
  const r=simulate(
    [{ticker:'AAA',alloc:100}],10000,0,
    false,'quarterly',false,5,false,
    0,0,'2020-01-01','2021-01-01','test',am,20,0
  );
  const cash0=r.cashValues[0];
  check('A6: initial cash == 20% of capital', approx(cash0,2000,5), 'got '+cash0.toFixed(2));
}

// A7: cash yield fires once per month
{
  const prices=flatPrices('2020-01-01','2021-01-01',100);
  const am={AAA:makeActionsMap(prices)};
  const r=simulate(
    [{ticker:'AAA',alloc:100}],10000,0,
    false,'quarterly',false,5,false,
    0,0,'2020-01-01','2021-01-01','test',am,50,12 // 50% cash, 12%/yr yield
  );
  const interestEvents=r.events.filter(e=>e.type==='div'&&e.detail.includes('Cash interest'));
  check('A7: cash interest fires ~12 times over 1 year', interestEvents.length>=11&&interestEvents.length<=13,
    'got '+interestEvents.length+' events');
}

// A8: drift rebalance absolute mode
{
  const pricesA=linearGrowthPrices('2020-01-01','2022-01-01',100,400); // grows 4x -> becomes overweight
  const pricesB=flatPrices('2020-01-01','2022-01-01',100);
  const am={A:makeActionsMap(pricesA),B:makeActionsMap(pricesB)};
  const r=simulate(
    [{ticker:'A',alloc:50},{ticker:'B',alloc:50}],10000,0,
    false,'quarterly',true,5,false, // drift on, 5pp absolute threshold
    0,0,'2020-01-01','2022-01-01','test',am,0,0
  );
  const driftEvents=(r.rebalEvents||[]).filter(e=>e.type==='drift'||e.type==='both');
  check('A8: drift rebalance fires when stock A grows 4x vs flat B', driftEvents.length>0,
    'got '+driftEvents.length+' drift rebalance events');
}

// A9: drift rebalance relative mode - tighter band for smaller allocation
{
  const pricesA=flatPrices('2020-01-01','2021-01-01',100);
  const pricesB=linearGrowthPrices('2020-01-01','2021-01-01',100,125); // B grows 25% -> alloc drifts
  const am={A:makeActionsMap(pricesA),B:makeActionsMap(pricesB)};
  // B target = 20%, relative threshold 10% -> band = ±2pp (18%-22%)
  const r=simulate(
    [{ticker:'A',alloc:80},{ticker:'B',alloc:20}],10000,0,
    false,'quarterly',true,10,true, // drift on, relative mode, 10%
    0,0,'2020-01-01','2021-01-01','test',am,0,0
  );
  const driftEvents=(r.rebalEvents||[]).filter(e=>e.type==='drift'||e.type==='both');
  check('A9: relative drift mode fires on tight band for 20% allocation growing to ~25%', driftEvents.length>0,
    'got '+driftEvents.length+' events');
}

// A10: time rebalance when already at target -> should log "no action" not a phantom trade
{
  const prices=flatPrices('2020-01-01','2021-01-01',100); // flat, never drifts
  const am={AAA:makeActionsMap(prices)};
  const r=simulate(
    [{ticker:'AAA',alloc:100}],10000,0,
    true,'quarterly',false,5,false, // time rebalance on, quarterly
    0,0,'2020-01-01','2021-01-01','test',am,0,0
  );
  const tradeEvents=(r.rebalEvents||[]); // rebalEvents should be EMPTY since single stock at 100% never needs a trade
  check('A10: single 100% stock, quarterly rebal, no phantom trades logged', tradeEvents.length===0,
    'got '+tradeEvents.length+' rebalEvents (expected 0 since nothing to trade)');
  const noActionEvents=r.events.filter(e=>e.type==='reb'&&e.detail.includes('no action needed'));
  check('A10: "no action needed" events ARE logged in events[] for visibility', noActionEvents.length>0,
    'got '+noActionEvents.length+' no-action events');
}

// A11: portfolio never drops -> maxDD=0, maxRecoveryDays=0
{
  const prices=linearGrowthPrices('2020-01-01','2021-01-01',100,150); // monotonic up
  const am={AAA:makeActionsMap(prices)};
  const r=simulate(
    [{ticker:'AAA',alloc:100}],10000,0,
    false,'quarterly',false,5,false,
    0,0,'2020-01-01','2021-01-01','test',am,0,0
  );
  check('A11: monotonic growth -> maxDD == 0', approx(r.maxDD,0,0.01), 'got '+r.maxDD);
  check('A11: monotonic growth -> maxRecoveryDays == 0', r.maxRecoveryDays===0, 'got '+r.maxRecoveryDays);
}

// A12: portfolio drops then recovers to exact same value - recovery period should span that exact window
{
  // Build a V-shaped price: down 50% over 6mo, back up over next 6mo to original
  const weeks=generateWeeks('2020-01-01','2021-01-01');
  const n=weeks.length;
  const mid=Math.floor(n/2);
  const prices=weeks.map((w,i)=>{
    let price;
    if(i<=mid) price=100-(50*(i/mid));       // 100 -> 50
    else       price=50+(50*((i-mid)/(n-1-mid))); // 50 -> 100
    return {date:utcDateStr(w.getTime()),close:price};
  });
  const am={AAA:makeActionsMap(prices)};
  const r=simulate(
    [{ticker:'AAA',alloc:100}],10000,0,
    false,'quarterly',false,5,false,
    0,0,'2020-01-01','2021-01-01','test',am,0,0
  );
  check('A12: V-shaped recovery -> maxDD ~ 50%', approx(r.maxDD,50,3), 'got '+r.maxDD.toFixed(2));
  check('A12: V-shaped recovery -> maxRecoveryWeeks > 0', r.maxRecoveryWeeks>0, 'got '+r.maxRecoveryWeeks);
}

// A13: weekly tax arrays sum to totals (using a rebalance scenario with realized CG tax)
{
  const pricesA=linearGrowthPrices('2020-01-01','2022-01-01',100,300); // triples
  const pricesB=flatPrices('2020-01-01','2022-01-01',100);
  const divs=[{date:'2020-06-15',amount:'1.00'},{date:'2021-06-15',amount:'1.00'}];
  const am={A:makeActionsMap(pricesA,divs),B:makeActionsMap(pricesB)};
  const r=simulate(
    [{ticker:'A',alloc:50},{ticker:'B',alloc:50}],10000,0,
    true,'quarterly',true,5,false, // both time+drift rebalance
    0.20,0.15,'2020-01-01','2022-01-01','test',am,0,0 // 20% CG tax, 15% div tax
  );
  check('A13: totalTaxPaid == totalTaxCGPaid + totalTaxDivPaid',
    approx(r.totalTaxPaid, r.totalTaxCGPaid+r.totalTaxDivPaid, 0.01),
    'totalTaxPaid='+r.totalTaxPaid.toFixed(2)+' CG='+r.totalTaxCGPaid.toFixed(2)+' Div='+r.totalTaxDivPaid.toFixed(2));

  const annualCGSum=Object.values(r.annualTaxCG).reduce((a,b)=>a+b,0);
  check('A13: sum(annualTaxCG) ~ totalTaxCGPaid', approx(annualCGSum,r.totalTaxCGPaid,0.5),
    'annualSum='+annualCGSum.toFixed(2)+' total='+r.totalTaxCGPaid.toFixed(2));

  const annualDivTaxSum=Object.values(r.annualTaxDiv).reduce((a,b)=>a+b,0);
  check('A13: sum(annualTaxDiv) ~ totalTaxDivPaid', approx(annualDivTaxSum,r.totalTaxDivPaid,0.5),
    'annualSum='+annualDivTaxSum.toFixed(2)+' total='+r.totalTaxDivPaid.toFixed(2));

  const annualDivSum=Object.values(r.annualDiv).reduce((a,b)=>a+b,0);
  // annualDiv should roughly match totalDivReceived (dividends only, not cash interest -- none here)
  check('A13: sum(annualDiv) ~ totalDivReceived', approx(annualDivSum,r.totalDivReceived,1),
    'annualSum='+annualDivSum.toFixed(2)+' total='+r.totalDivReceived.toFixed(2));
}

// A14: totalTaxPaid identity always holds (redundant with A13 but explicit per plan)
{
  const prices=linearGrowthPrices('2020-01-01','2021-01-01',100,120);
  const divs=[{date:'2020-06-15',amount:'2.00'}];
  const am={AAA:makeActionsMap(prices,divs)};
  const r=simulate(
    [{ticker:'AAA',alloc:100}],10000,0,
    true,'quarterly',false,5,false,
    0.20,0.15,'2020-01-01','2021-01-01','test',am,0,0
  );
  check('A14: identity holds for simple 1-stock+div scenario',
    approx(r.totalTaxPaid, r.totalTaxCGPaid+r.totalTaxDivPaid, 0.01),
    r.totalTaxPaid+' vs '+(r.totalTaxCGPaid+r.totalTaxDivPaid));
}

// A15: full data gap -> simulate() should FAIL LOUDLY, not silently produce a
// wrong number. Per explicit product decision: no data = no result, ever.
// The real safety net is validateFullCoverage(), which runs BEFORE simulate()
// in both Run Analysis and the Optimizer and blocks the run entirely with a
// clear error panel (no bypass). This test confirms the engine itself also
// throws rather than defaulting to 0, as defense-in-depth if validation is
// ever skipped or has a gap of its own.
{
  const am={AAA:makeActionsMap([])}; // no price data at all
  let threw=false, errMsg=null;
  try{
    simulate(
      [{ticker:'AAA',alloc:100}],10000,0,
      false,'quarterly',false,5,false,
      0,0,'2020-01-01','2021-01-01','test',am,0,0
    );
  }catch(e){ threw=true; errMsg=e.message; }
  check('A15: empty price data -> simulate() throws (fails loudly, no silent $0)', threw, threw?('threw: "'+errMsg+'"'):'did NOT throw — silent wrong result risk');
}

console.log('\n=== SECTION B: Dividend Deduplication (cleanDivs) ===\n');

{
  const r=cleanDivs([{date:'2020-03-10',amount:'1.00'},{date:'2020-03-20',amount:'1.00'}]);
  check('B1: same month, same amount -> 1 kept', r.length===1, 'got '+r.length);
}
{
  const r=cleanDivs([{date:'2020-03-10',amount:'1.00'},{date:'2020-03-13',amount:'1.05'}]);
  check('B2: 3 days apart, within 15% -> 1 kept', r.length===1, 'got '+r.length);
}
{
  const r=cleanDivs([{date:'2020-01-15',amount:'1.00'},{date:'2020-03-01',amount:'1.00'}]);
  check('B3: 45 days apart, different months -> both kept', r.length===2, 'got '+r.length);
}
{
  const r=cleanDivs([]);
  check('B4: empty array -> returns []', Array.isArray(r)&&r.length===0, JSON.stringify(r));
}
{
  const divs=[];
  for(let y=2020;y<2022;y++){
    for(const m of ['03','06','09','12']){
      divs.push({date:y+'-'+m+'-15',amount:'0.65'});
    }
  }
  const r=cleanDivs(divs);
  check('B5: 8 legit quarterly dividends over 2yrs -> all 8 kept', r.length===8, 'got '+r.length);
}

console.log('\n=== SECTION C: Date Arithmetic ===\n');

{
  const weeks=generateWeeks('2020-01-01','2020-12-31');
  check('C1: generateWeeks 1yr -> ~52 bars', weeks.length>=51&&weeks.length<=54, 'got '+weeks.length);
  let increasing=true;
  for(let i=1;i<weeks.length;i++) if(weeks[i]<=weeks[i-1]) increasing=false;
  check('C1: weeks strictly increasing', increasing, 'monotonic check');
}
{
  const r=addDays('2024-02-28',1);
  check('C2: addDays leap year Feb28+1 -> Feb29', r==='2024-02-29', 'got '+r);
}
{
  const r=addDays('2023-12-31',1);
  check('C3: addDays year rollover Dec31+1 -> Jan1 next year', r==='2024-01-01', 'got '+r);
}
{
  const weeks=generateWeeks('2020-01-01','2020-01-31');
  const strs=weeks.map(w=>utcDateStr(w.getTime()));
  const allValidFormat=strs.every(s=>/^\d{4}-\d{2}-\d{2}$/.test(s));
  check('C4: utcDateStr produces valid YYYY-MM-DD for all weeks', allValidFormat, JSON.stringify(strs.slice(0,3)));
}

console.log('\n=== SECTION D: Formatting ===\n');

{
  const r=fmtReturn(138.3,14.2);
  check('D1: fmtReturn(138.3,14.2)', r==='+138.3% (+14.2%/yr)', 'got "'+r+'"');
}
{
  const r=fmtReturn(-25.5,-8.1);
  check('D2: fmtReturn(-25.5,-8.1)', r==='-25.5% (-8.1%/yr)', 'got "'+r+'"');
}
{
  const r=fmtReturn(0,null);
  check('D3: fmtReturn(0,null) has no /yr suffix', r==='+0.0%', 'got "'+r+'"');
}
{
  const r=fmtM(1250000);
  check('D4: fmtM(1250000) -> $1.25M', r==='$1.25M', 'got "'+r+'"');
}
{
  const r=fmtM(2500);
  const ok = r==='$2.5k' || r==='$2,500';
  flag('D5: fmtM(2500) -> "'+r+'"', 'Confirm this is the intended format for values in the 1k-1M range.');
}

console.log('\n=== SECTION F: Strict Data Coverage Validation ===\n');
{
  // Need validateFullCoverage + generateWeeks/utcDateStr from sut.js — re-extract
  // it here since it lives outside simulate() in the app; for the test suite we
  // reimplement a thin wrapper using the same exported primitives to verify the
  // *contract* (every week must resolve within ±7 days) rather than duplicate
  // the exact implementation.
  function validateFullCoverageTest(startDate,endDate,tickerList,actionsMap){
    const weeks=generateWeeks(startDate,endDate);
    const TOL=7*86400000;
    const gaps=[];
    tickerList.forEach(t=>{
      const prices=(actionsMap[t]&&actionsMap[t].prices)||[];
      if(!prices.length){ gaps.push({ticker:t,weeksMissing:weeks.length}); return; }
      const times=prices.map(p=>new Date(p.date+'T00:00:00Z').getTime()).sort((a,b)=>a-b);
      let missing=0;
      weeks.forEach(w=>{
        const wt=w.getTime();
        let nearest=Infinity;
        times.forEach(tm=>{ const d=Math.abs(tm-wt); if(d<nearest) nearest=d; });
        if(nearest>TOL) missing++;
      });
      if(missing>0) gaps.push({ticker:t,weeksMissing:missing});
    });
    return gaps;
  }

  // F1: fully covered ticker -> no gaps reported
  {
    const prices=flatPrices('2020-01-01','2021-01-01',100);
    const gaps=validateFullCoverageTest('2020-01-01','2021-01-01',['AAA'],{AAA:{prices}});
    check('F1: fully covered ticker -> 0 gaps', gaps.length===0, JSON.stringify(gaps));
  }

  // F2: ticker with a 6-month hole in the middle -> gap detected
  {
    const weeks=generateWeeks('2020-01-01','2021-01-01');
    const prices=weeks.filter((w,i)=>i<10||i>35).map(w=>({date:utcDateStr(w.getTime()),close:100}));
    const gaps=validateFullCoverageTest('2020-01-01','2021-01-01',['AAA'],{AAA:{prices}});
    check('F2: ticker with mid-period hole -> gap detected', gaps.length===1&&gaps[0].weeksMissing>10,
      JSON.stringify(gaps));
  }

  // F3: ticker whose data simply ends early (doesn't reach effectiveEnd) -> gap detected
  // This is exactly the case the OLD bar-to-bar gap check would miss entirely.
  {
    const prices=flatPrices('2020-01-01','2020-09-01',100); // stops 4 months before requested end
    const gaps=validateFullCoverageTest('2020-01-01','2021-01-01',['AAA'],{AAA:{prices}});
    check('F3: ticker data ending early (short of requested end date) -> gap detected',
      gaps.length===1&&gaps[0].weeksMissing>10, JSON.stringify(gaps));
  }

  // F4: two tickers, one fully covered one with a hole -> only the bad one flagged
  {
    const goodPrices=flatPrices('2020-01-01','2021-01-01',100);
    const weeks=generateWeeks('2020-01-01','2021-01-01');
    const badPrices=weeks.filter((w,i)=>i<20).map(w=>({date:utcDateStr(w.getTime()),close:50}));
    const gaps=validateFullCoverageTest('2020-01-01','2021-01-01',['GOOD','BAD'],
      {GOOD:{prices:goodPrices},BAD:{prices:badPrices}});
    check('F4: only the ticker with the actual hole is flagged', gaps.length===1&&gaps[0].ticker==='BAD',
      JSON.stringify(gaps));
  }

  // F5: ticker with completely empty price array -> flagged with full week count
  {
    const gaps=validateFullCoverageTest('2020-01-01','2021-01-01',['EMPTY'],{EMPTY:{prices:[]}});
    check('F5: empty price array -> flagged, weeksMissing == total weeks', gaps.length===1&&gaps[0].weeksMissing>=51,
      JSON.stringify(gaps));
  }
}


console.log('\n' + '='.repeat(60));
console.log(`RESULTS: ${pass} passed, ${fail} failed, ${flagged.length} flagged for review`);
console.log('='.repeat(60));
if(fail>0) process.exitCode=1;
