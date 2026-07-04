// Auto-extracted System Under Test functions — DO NOT EDIT BY HAND.
// Regenerate with: python3 tests/extract_sut.py

function generateWeeks(startDate,endDate){
  const weeks=[],e=new Date(endDate);
  let d=new Date(startDate);
  while(d<=e){weeks.push(new Date(d));d.setDate(d.getDate()+7);}
  return weeks;
}

function utcDateStr(ms){
  const d=new Date(ms);
  return d.getUTCFullYear()+'-'+
    String(d.getUTCMonth()+1).padStart(2,'0')+'-'+
    String(d.getUTCDate()).padStart(2,'0');
}

function buildWindowIndex(events,windowDays=4){
  const idx={};
  events.forEach(ev=>{
    const base=new Date(ev.date+'T00:00:00Z').getTime();
    for(let delta=-windowDays;delta<=windowDays;delta++){
      const key=utcDateStr(base+delta*86400000);
      if(!idx[key]||delta===0) idx[key]=ev; // exact date wins over windowed
    }
  });
  return idx;
}

function buildPriceWindowIndex(prices,windowDays){
  const idx={};
  prices.forEach(p=>{
    const base=new Date(p.date+'T00:00:00Z').getTime();
    for(let delta=-windowDays;delta<=windowDays;delta++){
      const key=utcDateStr(base+delta*86400000);
      // Exact date always wins; otherwise only fill if not already set
      if(!idx[key]||delta===0) idx[key]=p.close;
    }
  });
  return idx;
}

function addDays(dateStr,n){
  const d=new Date(dateStr+'T00:00:00Z');
  d.setUTCDate(d.getUTCDate()+n);
  return utcDateStr(d.getTime());
}

function cleanDivs(divs){
  if(!divs||!divs.length) return [];

  // Sort by date ascending
  const sorted=[...divs].sort((a,b)=>a.date.localeCompare(b.date));
  const kept=[];

  sorted.forEach(d=>{
    const amount=parseFloat(d.amount)||0;
    const date=d.date;
    const ym=date.slice(0,7); // YYYY-MM

    // Check if this dividend is a near-duplicate of any already-kept dividend
    const isDup=kept.some(k=>{
      const kAmount=parseFloat(k.amount)||0;
      const kYm=k.date.slice(0,7);
      const daysDiff=Math.abs(new Date(date+'T00:00:00Z')-new Date(k.date+'T00:00:00Z'))/86400000;

      // Rule (a): same calendar month
      if(ym===kYm) return true;

      // Rule (b): within 20 days and amount within 15%
      if(daysDiff<=20){
        const avgAmt=(amount+kAmount)/2;
        if(avgAmt>0&&Math.abs(amount-kAmount)/avgAmt<=0.15) return true;
      }
      return false;
    });

    if(!isDup) kept.push(d);
  });

  console.log('[cleanDivs] '+divs.length+' → '+kept.length+' dividends ('+(divs.length-kept.length)+' duplicates removed)');
  return kept;
}

function mergeByDate(a,b){
  const map={};
  [...a,...b].forEach(x=>{map[x.date]=x;});
  return Object.values(map).sort((x,y)=>x.date.localeCompare(y.date));
}

function simulate(nStocks,capital,addMoney,rebalTimeOn,rebalFreq,rebalDriftOn,rebalThresh,rebalDriftRelative=false,taxCG,taxDiv,startDate,endDate,basketName,actionsMap,cashAllocPct=0,cashYieldPct=0){
  const weeks=generateWeeks(startDate,endDate);
  const nW=weeks.length;

  // ── Price lookup helpers ──────────────────────────────────────────────────
  // Returns the real close price for a ticker on a given week, or null if the
  // ticker has no data for that date (i.e. it didn't exist yet / was delisted).
  // "Doesn't exist" = weekStr is before the first price OR after the last price.
  // Null is the key signal used throughout the simulation to skip the stock.
  function getPriceOrNull(ticker,weekStr){
    const ac=actionsMap[ticker];
    if(!ac||!ac.prices||!ac.prices.length) return null;
    // Check if this week is within the stock's available data range
    const firstDate=ac.prices[0].date;
    const lastDate =ac.prices[ac.prices.length-1].date;
    // Allow ±4 days tolerance at boundaries (weekends/holidays)
    if(weekStr<addDays(firstDate,-4)||weekStr>addDays(lastDate,4)) return null;
    // priceIndex lookup (exact + ±4-day window)
    if(ac.priceIndex){
      const p=ac.priceIndex[weekStr];
      if(p!=null&&p>0) return p;
    }
    // Nearest real price within ±7 days (holiday/gap tolerance)
    const d=new Date(weekStr+'T00:00:00Z').getTime();
    let best=null,bestDiff=7*86400000;
    ac.prices.forEach(pt=>{
      const diff=Math.abs(new Date(pt.date+'T00:00:00Z').getTime()-d);
      if(diff<bestDiff){bestDiff=diff;best=pt.close;}
    });
    return best; // may still be null if no price within 7 days
  }

  // Throws if no price at all — only called when we expect data to exist
  function getPrice(ticker,weekStr){
    const p=getPriceOrNull(ticker,weekStr);
    if(p!=null) return p;
    throw new Error('No price data for '+ticker+' at '+weekStr);
  }

  // Returns the first available date for a ticker (its "listing date" in our data)
  function firstAvailableDate(ticker){
    const ac=actionsMap[ticker];
    return ac&&ac.prices&&ac.prices.length?ac.prices[0].date:null;
  }

  // ── Initial purchase using real prices ────────────────────────────────────
  // Stocks that don't have data on startDate (listed later) are skipped;
  // their allocation is kept in cash until the stock becomes available.
  const firstWeekStr=utcDateStr(weeks[0].getTime());
  const holdings={},costBasis={};
  let cash=0;
  // All stocks are guaranteed to have data at startDate (dates were clamped in runBacktest).
  const pendingStocks=new Set();

  // All allocs (stocks + cash) are normalized to sum to 100% of full capital.
  // Each stock gets capital × s.alloc%, cash gets capital × cashAllocPct%.
  // No separate "stock capital" — everything is a direct % of total capital.
  nStocks.forEach(s=>{
    const p=getPriceOrNull(s.ticker,firstWeekStr);
    if(p!=null&&p>0){
      holdings[s.ticker]=(capital*(s.alloc/100))/p;
      costBasis[s.ticker]=p;
    } else {
      holdings[s.ticker]=0;costBasis[s.ticker]=0;
      cash+=capital*(s.alloc/100);
      pendingStocks.add(s.ticker);
    }
  });
  // Cash allocation portion goes directly to cash balance
  cash+=capital*(cashAllocPct/100);

  const portfolioValues=[],stockValues={},cashValues=[],labels=[],events=[],rebalEvents=[];
  const weeklyTaxCG=[],weeklyTaxDiv=[],weeklyDiv=[];
  const cashInterestHistory=[]; // weekly interest income on cash reserve (pushed once per week)
  const divByStock={};
  let totalCashInterest=0;
  let cashInterestThisWeek=0; // reset each week
  nStocks.forEach(s=>{stockValues[s.ticker]=[];divByStock[s.ticker]=0;});
  let totalTaxPaid=0,totalDivReceived=0,totalTaxCGPaid=0;

  // Extra per-week series for the snapshot charts
  const shareHistory={},priceHistory={};
  nStocks.forEach(s=>{shareHistory[s.ticker]=[];priceHistory[s.ticker]=[];});

  // Dividend index: map each dividend to EXACTLY ONE weekly bar (nearest by date).
  // Using buildWindowIndex(±4 days) caused the same dividend to appear on 2 consecutive
  // weekly bars when the ex-date fell between them — doubling the cash received.
  // Instead: for each dividend, find the single closest week in our simulation weeks[],
  // and store it in a weekStr→dividend map. If two dividends map to the same week,
  // sum them (extremely rare, handled correctly).
  const divIdx={};
  const splitIdx={};
  nStocks.forEach(s=>{
    const ac=actionsMap[s.ticker]||{divs:[],splits:[]};

    // Build exact-nearest dividend index
    const dmap={};
    (ac.divs||[]).forEach(dv=>{
      const dvMs=new Date(dv.date+'T00:00:00Z').getTime();
      let bestWk=null,bestDiff=Infinity;
      weeks.forEach(wk=>{
        const diff=Math.abs(wk.getTime()-dvMs);
        if(diff<bestDiff){bestDiff=diff;bestWk=utcDateStr(wk.getTime());}
      });
      // Only assign if nearest week is within 7 days (avoid attaching to distant weeks)
      if(bestWk&&bestDiff<=7*86400000){
        if(!dmap[bestWk]) dmap[bestWk]={date:dv.date,amount:0};
        dmap[bestWk].amount+=parseFloat(dv.amount); // sum if two divs map to same week
      }
    });
    divIdx[s.ticker]=dmap;

    // Splits still use window index (splits are less frequent, ±4 day is fine)
    splitIdx[s.ticker]=buildWindowIndex(ac.splits,4);
  });
  const appliedSplits={};
  nStocks.forEach(s=>{appliedSplits[s.ticker]=new Set();});

  weeks.forEach((week,wi)=>{
    const weekStr=utcDateStr(week.getTime());

    // 1. LOG SPLITS (informational — adjclose prices are already split-adjusted)
    nStocks.forEach(s=>{
      const sp=splitIdx[s.ticker][weekStr];
      if(sp&&!appliedSplits[s.ticker].has(sp.date)){
        appliedSplits[s.ticker].add(sp.date);
        events.push({week:weekStr,type:'split',
          detail:s.ticker+' '+sp.ratio+'-for-1 split on '+sp.date+
            ' (Yahoo close prices are split-adjusted — no share count adjustment needed)'});
      }
    });

    // 1b. CHECK FOR NEWLY AVAILABLE STOCKS (pending → active)
    // When a pending stock's data becomes available, buy it immediately using
    // accumulated cash, at its actual first trading price.
    if(pendingStocks.size>0){
      pendingStocks.forEach(ticker=>{
        const p=getPriceOrNull(ticker,weekStr);
        if(p!=null&&p>0){
          // Stock is now available — buy it with its target allocation share of
          // whatever cash we have (rough approximation; exact rebalance will fix it)
          const s=nStocks.find(x=>x.ticker===ticker);
          const targetVal=s?(cash+nStocks.reduce((sum,x)=>sum+holdings[x.ticker]*(getPriceOrNull(x.ticker,weekStr)||0),0))*(s.alloc/100):0;
          const invest=Math.min(targetVal,cash);
          if(invest>0&&p>0){
            const shares=invest/p;
            holdings[ticker]=shares;
            costBasis[ticker]=p;
            cash-=invest;
            events.push({week:weekStr,type:'buy',
              detail:ticker+' now available at $'+p.toFixed(2)+
                ' — bought '+shares.toFixed(4)+' shares ($'+invest.toFixed(2)+')'});
          }
          pendingStocks.delete(ticker);
        }
      });
    }

    // Get real prices for this week — null for pending/unavailable stocks
    const prices={};
    nStocks.forEach(s=>{
      const p=getPriceOrNull(s.ticker,weekStr);
      prices[s.ticker]=p!=null?p:0; // 0 means "not available this week"
    });

    // 2. MONTHLY INJECTION — deploy immediately into available stocks
    if(wi>0&&wi%4===0&&addMoney>0){
      // Each stock + cash gets its alloc% of the monthly addition directly.
      // cashAllocPct% of addMoney goes to cash reserve; stock allocs are % of full total.
      const available=nStocks.filter(s=>prices[s.ticker]>0);
      const pendingAlloc=nStocks.filter(s=>prices[s.ticker]===0).reduce((sum,s)=>sum+s.alloc,0);
      cash+=addMoney*(pendingAlloc/100); // pending stocks: hold in cash
      cash+=addMoney*(cashAllocPct/100); // cash allocation portion
      available.forEach(s=>{
        const invest=addMoney*(s.alloc/100);
        const ns=invest/prices[s.ticker];
        costBasis[s.ticker]=holdings[s.ticker]>0
          ?(costBasis[s.ticker]*holdings[s.ticker]+prices[s.ticker]*ns)/(holdings[s.ticker]+ns)
          :prices[s.ticker];
        holdings[s.ticker]+=ns;
      });
      if(wi%52===0) events.push({week:weekStr,type:'buy',detail:'Annual recap: +$'+(addMoney*12).toFixed(0)+' contributed'+(pendingAlloc>0?' ($'+(addMoney*pendingAlloc/100).toFixed(0)+' held as cash for pending stocks)':'')});
    }

    // 3a. CASH INTEREST — paid on the LAST weekly bar of each calendar month.
    // Detect month-end: when the next week crosses into a new month (or final week).
    if(cashAllocPct>0&&cashYieldPct>0&&wi>0){
      const thisMonth=weekStr.slice(0,7); // YYYY-MM
      const nextWeekStr=wi+1<weeks.length?utcDateStr(weeks[wi+1].getTime()):null;
      const nextMonth=nextWeekStr?nextWeekStr.slice(0,7):null;
      const isLastBarOfMonth=!nextMonth||nextMonth!==thisMonth;
      if(isLastBarOfMonth){
        // Pay interest on the ACTUAL cash balance, not the estimated target reserve.
        // Using actual cash means: if stocks fell this month and cash wasn't rebalanced yet,
        // the interest reflects what's really sitting in cash — not a derived portfolio %.
        const actualCash=Math.max(0,cash);
        const interest=actualCash*(cashYieldPct/100/12);
        if(interest>0.01){
          const tax=interest*taxDiv;
          const net=interest-tax;
          cash+=net;
          totalDivReceived+=net;
          totalTaxPaid+=tax;
          totalCashInterest+=net;
          cashInterestThisWeek+=net;
          weeklyTaxDiv[wi]=(weeklyTaxDiv[wi]||0)+tax;
          events.push({week:weekStr,type:'div',
            detail:'Cash interest (end of '+thisMonth+'): '+cashYieldPct.toFixed(2)+'%/yr on $'+actualCash.toFixed(2)+
              ' cash = gross $'+interest.toFixed(2)+', tax $'+tax.toFixed(2)+', net $'+net.toFixed(2)});
        }
      }
    }


    // 3. DIVIDENDS → cash (sit until rebalance, NOT immediately reinvested)
    let divWeek=0;
    nStocks.forEach(s=>{
      const dv=divIdx[s.ticker][weekStr];
      if(dv&&dv.amount>0){
        const gross=holdings[s.ticker]*dv.amount;
        const tax=gross*taxDiv;
        const net=gross-tax;
        divWeek+=net;totalDivReceived+=net;totalTaxPaid+=tax;divByStock[s.ticker]+=net;
        weeklyDiv[wi]=(weeklyDiv[wi]||0)+net;
        weeklyTaxDiv[wi]=(weeklyTaxDiv[wi]||0)+tax;
        cash+=net;
        events.push({week:weekStr,type:'div',
          detail:s.ticker+' $'+dv.amount.toFixed(4)+'/share x '+holdings[s.ticker].toFixed(4)+
            ' = gross $'+gross.toFixed(2)+', tax $'+tax.toFixed(2)+', net $'+net.toFixed(2)+' held in cash'});
      }
    });
    // weeklyDiv[wi] and weeklyTaxDiv[wi] already set inside dividend block — no push needed

    // 4. REBALANCING — fires if time/drift condition OR cash war chest correction
    let doRebalTime=false, doRebalDrift=false;
    if(rebalTimeOn&&wi>0){
      if(rebalFreq==='monthly'  &&wi%4 ===0) doRebalTime=true;
      if(rebalFreq==='quarterly'&&wi%13===0) doRebalTime=true;
      if(rebalFreq==='annually' &&wi%52===0) doRebalTime=true;
    }
    if(rebalDriftOn&&wi>0){
      const tvd=nStocks.reduce((s,x)=>s+holdings[x.ticker]*prices[x.ticker],0)+Math.max(0,cash);
      if(tvd>0){
        const stockDrift=nStocks.some(s=>{
          const actual=(holdings[s.ticker]*prices[s.ticker]/tvd)*100;
          const deviation=Math.abs(actual-s.alloc);
          const band=rebalDriftRelative?(rebalThresh/100*s.alloc):rebalThresh;
          return deviation>band;
        });
        // Cash drift uses same mode as stocks (absolute pp or relative % of target)
        const cashActualPct=tvd>0?(Math.max(0,cash)/tvd)*100:0;
        const cashBand=rebalDriftRelative?(rebalThresh/100*cashAllocPct):rebalThresh;
        const cashDrift=cashAllocPct>0&&Math.abs(cashActualPct-cashAllocPct)>cashBand;
        doRebalDrift=stockDrift||cashDrift;
      }
    }
    const doRebal=doRebalTime||doRebalDrift;
    const rebalType=(doRebalTime&&doRebalDrift)?'both':doRebalTime?'time':'drift';

    let cgTax=0;
    if(doRebal){
      const cashBefore=cash;
      // Only rebalance stocks that are currently available (price > 0)
      const availableForRebal=nStocks.filter(s=>prices[s.ticker]>0);
      const tv=nStocks.reduce((s,x)=>s+holdings[x.ticker]*prices[x.ticker],0)+cash;
      // Capture per-stock detail for the rebalance breakdown table
      const rebalDetail=[]; // [{ticker, action:'sell'|'buy', sharesBefore, sharesAfter, sharesDelta, price, valueDelta, gainTax, allocBefore, allocTarget}]

      // Pre-rebalance allocations (for reporting)
      const allocBefore={};
      nStocks.forEach(s=>{allocBefore[s.ticker]=tv>0?(holdings[s.ticker]*prices[s.ticker]/tv)*100:0;});

      // Pass 1: sell overweight (only available stocks)
      availableForRebal.forEach(s=>{
        const target=tv*(s.alloc/100),current=holdings[s.ticker]*prices[s.ticker],diff=target-current;
        if(diff<-1){
          const sharesBefore=holdings[s.ticker];
          const sell=(-diff)/prices[s.ticker];
          const gain=(prices[s.ticker]-costBasis[s.ticker])*sell;
          let t=0;
          if(gain>0){t=gain*taxCG;cgTax+=t;totalTaxPaid+=t;totalTaxCGPaid+=t;
            weeklyTaxCG[wi]=(weeklyTaxCG[wi]||0)+t;}
          holdings[s.ticker]-=sell;
          cash+=(sell*prices[s.ticker])-t;
          costBasis[s.ticker]=prices[s.ticker];
          rebalDetail.push({ticker:s.ticker,action:'sell',
            sharesBefore,sharesAfter:holdings[s.ticker],sharesDelta:-sell,
            price:prices[s.ticker],valueDelta:-(sell*prices[s.ticker]),
            gain,gainTax:t,allocBefore:allocBefore[s.ticker],allocTarget:s.alloc});
        }
      });

      // Pass 2: buy underweight with available cash.
      // IMPORTANT: tv2 is computed ONCE before the loop from the post-sell state.
      const tv2=nStocks.reduce((x,y)=>x+holdings[y.ticker]*prices[y.ticker],0)+cash;
      // Keep cashAllocPct% of portfolio as reserve; only spend the excess.
      const cashReserveTarget=cashAllocPct>0?tv2*(cashAllocPct/100):0;
      let cashRemaining=Math.max(0,cash-cashReserveTarget);
      availableForRebal.forEach(s=>{
        const target=tv2*(s.alloc/100),current=holdings[s.ticker]*prices[s.ticker],diff=target-current;
        if(diff>1&&cashRemaining>1){
          const sharesBefore=holdings[s.ticker];
          // Spend the lesser of: what's needed to reach target, or remaining cash
          const spend=Math.min(diff,cashRemaining),ns=spend/prices[s.ticker];
          costBasis[s.ticker]=holdings[s.ticker]>0
            ?(costBasis[s.ticker]*holdings[s.ticker]+prices[s.ticker]*ns)/(holdings[s.ticker]+ns)
            :prices[s.ticker];
          holdings[s.ticker]+=ns;cash-=spend;cashRemaining-=spend;
          rebalDetail.push({ticker:s.ticker,action:'buy',
            sharesBefore,sharesAfter:holdings[s.ticker],sharesDelta:ns,
            price:prices[s.ticker],valueDelta:spend,
            gain:0,gainTax:0,allocBefore:allocBefore[s.ticker],allocTarget:s.alloc});
        }
      });

      const anySold=rebalDetail.some(d=>d.action==='sell');
      const anyBought=rebalDetail.some(d=>d.action==='buy');

      if(anySold||anyBought){
        // Something happened — log full rebalance details
        rebalEvents.push({wi,weekStr,type:rebalType,cgTax,
          cashBefore:Math.max(0,cashBefore),cashAfter:Math.max(0,cash),
          totalValue:tv,detail:rebalDetail});
        const sellSummary=rebalDetail.filter(d=>d.action==='sell')
          .map(d=>d.ticker+' -'+Math.abs(d.sharesDelta).toFixed(3)+'sh (-$'+Math.abs(d.valueDelta).toFixed(2)+')')
          .join(', ');
        const buySummary=rebalDetail.filter(d=>d.action==='buy')
          .map(d=>d.ticker+' +'+d.sharesDelta.toFixed(3)+'sh (+$'+d.valueDelta.toFixed(2)+')')
          .join(', ');
        events.push({week:weekStr,type:'reb',
          detail:'Rebalanced ('+rebalType+')'
            +(anySold?' | sold: '+sellSummary:'')
            +(anyBought?' | bought: '+buySummary:'')
            +' | CG tax $'+cgTax.toFixed(2)
            +', cash $'+Math.max(0,cashBefore).toFixed(2)+' → $'+Math.max(0,cash).toFixed(2)});
      } else {
        // No action taken — log current allocations for visibility
        const tvNow=nStocks.reduce((s,x)=>s+holdings[x.ticker]*prices[x.ticker],0)+Math.max(0,cash);
        const allocSummary=nStocks.map(s=>{
          const actual=tvNow>0?(holdings[s.ticker]*prices[s.ticker]/tvNow*100):0;
          const diff=actual-s.alloc;
          return s.ticker+' '+actual.toFixed(1)+'%'+(diff>=0?'+':'')+diff.toFixed(1)+'pp';
        }).join(', ')
        +(cashAllocPct>0?' | CASH '+(tvNow>0?(Math.max(0,cash)/tvNow*100).toFixed(1):0)+'% (target '+cashAllocPct+'%)':'');
        events.push({week:weekStr,type:'reb',
          detail:'Rebalance ('+rebalType+') — no action needed. '+
            'Allocations: '+allocSummary});
      }
    }
    // weeklyTaxCG[wi] already set inside rebalance block — no push needed

    const total=nStocks.reduce((s,x)=>s+holdings[x.ticker]*prices[x.ticker],0)+Math.max(0,cash);
    portfolioValues.push(total);
    cashValues.push(Math.max(0,cash));
    cashInterestHistory.push(cashInterestThisWeek);
    cashInterestThisWeek=0; // reset for next week
    nStocks.forEach(s=>{
      stockValues[s.ticker].push(holdings[s.ticker]*prices[s.ticker]);
      shareHistory[s.ticker].push(holdings[s.ticker]);
      priceHistory[s.ticker].push(prices[s.ticker]);
    });
    labels.push(weekStr.slice(0,7));
  });

  // Final snapshot — use real price for the last simulation week
  const fi=weeks.length-1;
  const fiStr=utcDateStr(weeks[fi].getTime());
  const finalHoldings={};
  nStocks.forEach(s=>{
    const p=getPrice(s.ticker,fiStr,fi);
    finalHoldings[s.ticker]={shares:holdings[s.ticker],price:p,value:holdings[s.ticker]*p};
  });
  const finalCash=Math.max(0,cash);

  // Risk
  const rets=[];
  for(let i=1;i<portfolioValues.length;i++)
    rets.push((portfolioValues[i]-portfolioValues[i-1])/portfolioValues[i-1]);
  const mu=rets.reduce((a,b)=>a+b,0)/rets.length;
  const stdDev=Math.sqrt(rets.reduce((a,b)=>a+(b-mu)**2,0)/rets.length)*Math.sqrt(52)*100;
  let peak=portfolioValues[0],maxDD=0,maxDDPeakIdx=0,maxDDTroughIdx=0;
  let curPeakVal=portfolioValues[0],curPeakIdx=0;
  portfolioValues.forEach((v,i)=>{
    if(v>curPeakVal){curPeakVal=v;curPeakIdx=i;}
    const dd=(curPeakVal-v)/curPeakVal;
    if(dd>maxDD){maxDD=dd;maxDDPeakIdx=curPeakIdx;maxDDTroughIdx=i;}
  });

  // ── Maximum recovery period ────────────────────────────────────────────────
  // For every index i (the "drawdown start"), find the first index j > i where
  // the portfolio has fully recovered back to portfolioValues[i].
  // The longest such (j - i) span is the max recovery period.
  // We only count periods that actually involved a drawdown (v[j] dropped below v[i]).
  let maxRecoveryWeeks=0, maxRecoveryStartIdx=0, maxRecoveryEndIdx=0;
  for(let i=0;i<portfolioValues.length;i++){
    const startVal=portfolioValues[i];
    // Check if there's any drawdown after i
    let hadDrawdown=false;
    for(let j=i+1;j<portfolioValues.length;j++){
      if(portfolioValues[j]<startVal) hadDrawdown=true;
      if(hadDrawdown&&portfolioValues[j]>=startVal){
        // Recovery found: j is the first bar back at or above startVal
        const duration=j-i;
        if(duration>maxRecoveryWeeks){
          maxRecoveryWeeks=duration;
          maxRecoveryStartIdx=i;
          maxRecoveryEndIdx=j;
        }
        break; // move to next i
      }
    }
  }
  const maxRecoveryDays=Math.round(maxRecoveryWeeks*7);

  const totalInvested=capital+addMoney*Math.floor(weeks.length/4);
  const finalVal=portfolioValues[portfolioValues.length-1]||capital;
  const totalReturn=((finalVal-totalInvested)/totalInvested)*100;
  // CAGR: Compound Annual Growth Rate
  // Uses actual number of years between effectiveStart and effectiveEnd
  const simYears=(new Date(endDate+'T00:00:00Z')-new Date(startDate+'T00:00:00Z'))/(365.25*86400000);
  const cagr=simYears>0?(Math.pow(Math.max(0,finalVal)/Math.max(1,totalInvested),1/simYears)-1)*100:0;

  const annualTax={},annualTaxCG={},annualTaxDiv={},annualDiv={};
  weeks.forEach((w,i)=>{
    const y=utcDateStr(w.getTime()).slice(0,4);
    if(!annualTax[y]){annualTax[y]=0;annualTaxCG[y]=0;annualTaxDiv[y]=0;annualDiv[y]=0;}
    annualTaxCG[y] +=(weeklyTaxCG[i]||0);
    annualTaxDiv[y]+=(weeklyTaxDiv[i]||0);
    annualTax[y]   +=(weeklyTaxCG[i]||0)+(weeklyTaxDiv[i]||0);
    annualDiv[y]   +=(weeklyDiv[i]||0);
  });

  const divDateMap={},splitDateMap={};
  nStocks.forEach(s=>{
    divDateMap[s.ticker]  =(actionsMap[s.ticker]?.divs  ||[]);
    splitDateMap[s.ticker]=(actionsMap[s.ticker]?.splits||[]);
  });

  const totalTaxDivPaid=totalTaxPaid-totalTaxCGPaid;
  return{nStocks,labels,portfolioValues,stockValues,cashValues,cashInterestHistory,totalCashInterest,shareHistory,priceHistory,events,rebalEvents,maxDDPeakIdx,maxDDTroughIdx,maxRecoveryStartIdx,maxRecoveryEndIdx,maxRecoveryWeeks,maxRecoveryDays,
    totalReturn,cagr,simYears,stdDev,maxDD:maxDD*100,finalVal,totalInvested,cashAllocPct,
    totalTaxPaid,totalDivReceived,totalTaxCGPaid,totalTaxDivPaid,divByStock,
    annualTax,annualTaxCG,annualTaxDiv,annualDiv,basketName,capital,
    finalHoldings,finalCash,divDateMap,splitDateMap,actionsMap};
}

function fmtReturn(totalReturn,cagr){
  const sign=totalReturn>=0?'+':'';
  const cagrSign=(cagr||0)>=0?'+':'';
  return sign+totalReturn.toFixed(1)+'%'+(cagr!=null?' ('+cagrSign+cagr.toFixed(1)+'%/yr)':'');
}

const fmt=n=>n.toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0});

const fmt2=n=>n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});

const fmtM=n=>n>=1e6?'$'+(n/1e6).toFixed(2)+'M':n>=1e3?'$'+fmt(n):'$'+fmt2(n);

module.exports = {generateWeeks,utcDateStr,buildWindowIndex,buildPriceWindowIndex,addDays,cleanDivs,mergeByDate,simulate,fmtReturn,fmt,fmt2,fmtM};
