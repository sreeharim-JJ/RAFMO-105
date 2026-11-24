/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * *********************************************************************************************************************************
 *
 * Rafmoh Bullion NS IN
 *
 * RAFMO-105 : Making Charge Master and Purity-Based Item Rate Calculation with Percentage and Per-Gram Charges
 *
 * *********************************************************************************************************************************
 *
 * Author : Jobin and Jismi
 *
 * Date Created : 20-November-2026
 *
 * COPYRIGHT © 2026 Jobin & Jismi IT Services LLP.
 * All rights reserved. This script is a proprietary product of Jobin & Jismi IT Services LLP and is protected by copyright
 * law and international treaties. Unauthorized reproduction or distribution of this script, or any portion of it,
 * may result in severe civil and criminal penalties and will be prosecuted to the maximum extent possible under law.
 *
 * Description : Shared custom module used by the Making Charge Master validation, the Purchase Order client script and the
 *               Purchase Order user event. It holds the field/record ID configuration (CFG) and the rate logic:
 *                 - getItemInfo(itemId)                          : Purity % and Metal Type from the Item Master.
 *                 - getPureRate(metalType, currencyId, tranDate) : latest Daily Metal Rate effective on or before the
 *                                                                  transaction date (returns 0 when none is found).
 *                 - getApprovedMakingCharge(itemId, vendorId, tranDate) : latest APPROVED, active, in-date Making Charge
 *                                                                  record (customrecord_jj_mc_chart) for Item + Vendor.
 *                 - calculateRate(pureRate, purityPct, mcPct, mcPerGram)
 *                       Final Rate = (Pure Rate x Purity%) + (Pure Rate x MC%) + MC per Gram, rounded to 2 decimals.
 *                 - computeLineRate(itemId, vendorId, tranDate, currencyId) : runs the full chain and returns
 *                       { status, rate, mcId, message } where status is one of
 *                       OK | NO_PURITY | NO_METAL_TYPE | NO_METAL_RATE | NO_MAKING_CHARGE.
 *               Helpers num(), round() and toDateStr() are also exported.
 *
 * Usage :
 *   define(['./jj_cm_charge_master_rafmo105'], (lib) => {
 *       const result = lib.computeLineRate(itemId, vendorId, new Date(), currencyId);
 *       if (result.status === 'OK') { ... result.rate ... }
 *   });
 *
 * REVISION HISTORY :
 *
 * @version 1.0 RAFMO-105 : 20-November-2026 : Created the initial build by JJ0494
 *
 * *********************************************************************************************************************************
 */
define(['N/search', 'N/format', 'N/log'],
    (search, format, log) => {

        /**
         * Configuration - confirm every ID against the account.
         */
        const CFG = {
            MC: {
                REC: 'customrecord_jj_mc_chart',
                ITEM: 'custrecord_jj_mc_item',
                VENDOR: 'custrecord_jj_mc_vendor',
                PERCENT: 'custrecord_jj_mc_percent',
                PER_GRAM: 'custrecord_jj_mc_pergram',
                PURITY: 'custrecord_jj_mc_purity',   // display copy of Item Purity % (Percent, Store Value checked)
                APPROVED: 'custrecord_jj_mc_approved',
                FROM_DATE: 'custrecord_jj_mc_effective_from',
                TO_DATE: 'custrecord_jj_mc_effective_to'
            },
            ITEM: {
                PURITY: 'custitem_jj_purity_percent',   // Purity % (e.g. 75 for G18)
                METAL_TYPE: 'custitem_jj_metal_type'// list/record used by Daily Metal Rate
            },
            RATE: {
                REC: 'customrecord_jj_metal_rate',
                METAL: 'custrecord_jj_mr_metal',
                CURRENCY: 'custrecord_jj_mr_currency',
                RATE: 'custrecord_jj_mr_rate',
                EFFDATE: 'custrecord_jj_mr_effdate'
            },
            ROUND_DECIMALS: 2
        };

        /**
         * Converts NetSuite numeric / percent values ("2.0%", "10,000") to a Number.
         * @param {string|number} value
         * @returns {number}
         */
        function num(value) {
            if (value === null || value === undefined || value === '') return 0;
            let n = parseFloat(String(value).replace('%', '').replace(/,/g, ''));
            return isNaN(n) ? 0 : n;
        }

        /**
         * Rounds a number to the configured decimals.
         * @param {number} value
         * @param {number} [decimals]
         * @returns {number}
         */
        function round(value, decimals) {
            let d = (decimals === undefined) ? CFG.ROUND_DECIMALS : decimals;
            let f = Math.pow(10, d);
            return Math.round((value + Number.EPSILON) * f) / f;
        }

        /**
         * Converts a Date to a string in the user's date format (for search filters).
         * @param {Date|string} value
         * @returns {string}
         */
        function toDateStr(value) {
            if (value instanceof Date) {
                return format.format({ value: value, type: format.Type.DATE });
            }
            return value;
        }

        /**
         * Gets purity % and metal type from the Item Master.
         * @param {string|number} itemId
         * @returns {{purity: number, metalType: string}}
         */
        function getItemInfo(itemId) {
            let fields = search.lookupFields({
                type: search.Type.ITEM,
                id: itemId,
                columns: [CFG.ITEM.PURITY, CFG.ITEM.METAL_TYPE]
            });
            log.debug('getItemInfo raw lookup', JSON.stringify({ itemId: itemId, fields: fields }));
            let metal = fields[CFG.ITEM.METAL_TYPE];
            return {
                purity: num(fields[CFG.ITEM.PURITY]),
                metalType: Array.isArray(metal) && metal.length ? metal[0].value : (metal || '')
            };
        }

        /**
         * Gets the latest Pure Metal Rate effective on or before the transaction date.
         * jj_lib_rate.getLatestRate can replace the body of this function if preferred.
         * @param {string|number} metalType
         * @param {string|number} currencyId
         * @param {Date|string} tranDate
         * @returns {number} 0 when no rate is found
         */
        
        function getPureRate(metalType, currencyId, tranDate) {

    log.audit('getPureRate INPUT', {
        metalType: metalType,
        currencyId: currencyId,
        tranDate: toDateStr(tranDate)
    });

    if (!metalType) {
        log.error('NO METAL TYPE', 'Item metal type is empty');
        return 0;
    }

    var filters = [
        [CFG.RATE.METAL, 'anyof', metalType],
        'AND',
        [CFG.RATE.EFFDATE, 'onorbefore', toDateStr(tranDate)],
        'AND',
        ['isinactive', 'is', 'F']
    ];

    // TEMPORARILY REMOVE CURRENCY FILTER FOR TESTING
    // if (currencyId) {
    //     filters.push('AND');
    //     filters.push([CFG.RATE.CURRENCY, 'anyof', currencyId]);
    // }

    var rate = 0;

    search.create({
        type: CFG.RATE.REC,
        filters: filters,
        columns: [
            search.createColumn({
                name: CFG.RATE.EFFDATE,
                sort: search.Sort.DESC
            }),
            search.createColumn({
                name: CFG.RATE.RATE
            }),
            search.createColumn({
                name: CFG.RATE.METAL
            }),
            search.createColumn({
                name: CFG.RATE.CURRENCY
            })
        ]
    }).run().each(function(result) {

        log.audit('RATE FOUND', {
            id: result.id,
            rate: result.getValue(CFG.RATE.RATE),
            metal: result.getText(CFG.RATE.METAL),
            currency: result.getText(CFG.RATE.CURRENCY),
            effDate: result.getValue(CFG.RATE.EFFDATE)
        });

        rate = num(result.getValue(CFG.RATE.RATE));
        return false;
    });

    log.audit('FINAL RATE', rate);

    return rate;
}

        /**
         * Gets the APPROVED, effective Making Charge record for Item / Vendor / Date.
         * @param {string|number} itemId
         * @param {string|number} vendorId
         * @param {Date|string} tranDate
         * @returns {{id: string, percent: number, perGram: number}|null}
         */
        function getApprovedMakingCharge(itemId, vendorId, tranDate) {
            let dateStr = toDateStr(tranDate);
            log.audit('getApprovedMakingCharge input', JSON.stringify({ itemId: itemId, vendorId: vendorId, date: dateStr }));
            let found = null;
            search.create({
                type: CFG.MC.REC,
                filters: [
                    [CFG.MC.ITEM, 'anyof', itemId], 'AND',
                    [CFG.MC.VENDOR, 'anyof', vendorId], 'AND',
                    [CFG.MC.APPROVED, 'is', 'T'], 'AND',
                    ['isinactive', 'is', 'F'], 'AND',
                    [CFG.MC.FROM_DATE, 'onorbefore', dateStr], 'AND',
                    [[CFG.MC.TO_DATE, 'isempty', ''], 'OR', [CFG.MC.TO_DATE, 'onorafter', dateStr]]
                ],
                columns: [
                    search.createColumn({ name: CFG.MC.FROM_DATE, sort: search.Sort.DESC }),
                    CFG.MC.PERCENT,
                    CFG.MC.PER_GRAM
                ]
            }).run().each(function (result) {
                found = {
                    id: result.id,
                    percent: num(result.getValue(CFG.MC.PERCENT)),
                    perGram: num(result.getValue(CFG.MC.PER_GRAM))
                };
                return false;
            });
            log.audit('getApprovedMakingCharge result', found ? JSON.stringify(found) : 'null (no approved, in-date record for this Item / Vendor / Date)');
            return found;
        }

        /**
         * Final Rate = (Pure Rate x Purity%) + (Pure Rate x MC%) + MC per Gram
         * @param {number} pureRate
         * @param {number} purityPct
         * @param {number} mcPct
         * @param {number} mcPerGram
         * @returns {number}
         */
        function calculateRate(pureRate, purityPct, mcPct, mcPerGram) {
            let base = pureRate * (purityPct / 100);
            let pctCharge = pureRate * (mcPct / 100);
            return round(base + pctCharge + mcPerGram);
        }

        /**
         * Computes the rate for one PO line.
         * @param {string|number} itemId
         * @param {string|number} vendorId
         * @param {Date|string} tranDate
         * @param {string|number} currencyId
         * @returns {{status: string, rate: (number|undefined), message: (string|undefined), mcId: (string|undefined)}}
         *   status: OK | NO_PURITY | NO_METAL_TYPE | NO_METAL_RATE | NO_MAKING_CHARGE
         */
        function computeLineRate(itemId, vendorId, tranDate, currencyId) {
            log.audit('computeLineRate start', JSON.stringify({ itemId: itemId, vendorId: vendorId, date: toDateStr(tranDate), currencyId: currencyId }));
            let info = getItemInfo(itemId);
            log.audit('computeLineRate item info', JSON.stringify(info));
            if (!info.purity) {
                return { status: 'NO_PURITY', message: 'Item has no purity %. Rate not calculated.' };
            }
            if (!info.metalType) {
                return { status: 'NO_METAL_TYPE', message: 'Item has no Metal Type. Rate not calculated.' };
            }
            let pureRate = getPureRate(info.metalType, currencyId, tranDate);
            if (!pureRate) {
                return { status: 'NO_METAL_RATE', message: 'No Daily Pure Metal Rate found on or before the transaction date.' };
            }
            let mc = getApprovedMakingCharge(itemId, vendorId, tranDate);
            if (!mc) {
                return { status: 'NO_MAKING_CHARGE', message: 'No approved Making Charge record found for this Item/Vendor/Date.' };
            }
            let rate = calculateRate(pureRate, info.purity, mc.percent, mc.perGram);
            log.audit('computeLineRate OK', JSON.stringify({ itemId: itemId, vendorId: vendorId, pureRate: pureRate, purity: info.purity, mc: mc, rate: rate }));
            return { status: 'OK', rate: rate, mcId: mc.id };
        }

        return {
            CFG: CFG,
            num: num,
            round: round,
            toDateStr: toDateStr,
            getItemInfo: getItemInfo,
            getPureRate: getPureRate,
            getApprovedMakingCharge: getApprovedMakingCharge,
            calculateRate: calculateRate,
            computeLineRate: computeLineRate
        };
    });