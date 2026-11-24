/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
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
 * Description : Purchase Order user event script and the authoritative server-side check for the making charge rate.
 *               On create / edit / copy (beforeSubmit) it recalculates the rate and amount (rate x quantity) of every item
 *               line using the Daily Pure Metal Rate, Item Purity % and the APPROVED, effective Making Charge record for
 *               Item + Vendor + Transaction Date. Lines that cannot be priced (no purity, metal type, metal rate or
 *               approved making charge) are left unchanged and the reason is written to the Execution Log.
 *               Unapproved records are never applied.
 * REVISION HISTORY :
 *
 * @version 1.0 RAFMO-105 : 20-November-2026 : Created the initial build by JJ0494
 * *********************************************************************************************************************************
 */
define(['./jj_cm_charge_master_rafmo105'],
    /**
     * @param lib
     */
    (lib) => {

        /**
         * Defines the function definition that is executed before record is loaded.
         * @param {Object} scriptContext
         * @param {Record} scriptContext.newRecord - New record
         * @param {string} scriptContext.type - Trigger type; use values from the context.UserEventType enum
         * @param {Form} scriptContext.form - Current form
         * @param {ServletRequest} scriptContext.request - HTTP request information sent from the browser for a client action only.
         * @since 2015.2
         */
        const beforeLoad = (scriptContext) => {

        }

        /**
         * Defines the function definition that is executed before record is submitted.
         * @param {Object} scriptContext
         * @param {Record} scriptContext.newRecord - New record
         * @param {Record} scriptContext.oldRecord - Old record
         * @param {string} scriptContext.type - Trigger type; use values from the context.UserEventType enum
         * @since 2015.2
         */
        const beforeSubmit = (scriptContext) => {
            log.audit('PO making charge UE fired', 'type: ' + scriptContext.type);
            if (['create', 'edit', 'copy'].indexOf(scriptContext.type) === -1) return;
            try {
                let rec = scriptContext.newRecord;
                let vendorId = rec.getValue({ fieldId: 'entity' });
                let tranDate = rec.getValue({ fieldId: 'trandate' });
                let currencyId = rec.getValue({ fieldId: 'currency' });
                log.audit('PO header values', JSON.stringify({
                    vendor: vendorId, date: String(tranDate), currency: currencyId,
                    lines: rec.getLineCount({ sublistId: 'item' })
                }));
                if (!vendorId || !tranDate) return;

                let cache = {};
                let lineCount = rec.getLineCount({ sublistId: 'item' });
                for (let i = 0; i < lineCount; i++) {
                    let itemId = rec.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'item',
                        line: i
                    });
                    if (!itemId) continue;

                    if (!cache[itemId]) {
                        cache[itemId] = lib.computeLineRate(itemId, vendorId, tranDate, currencyId);
                    }
                    let result = cache[itemId];

                    if (result.status === 'OK') {
                        let quantity = lib.num(rec.getSublistValue({
                            sublistId: 'item',
                            fieldId: 'quantity',
                            line: i
                        }));
                        rec.setSublistValue({
                            sublistId: 'item',
                            fieldId: 'rate',
                            line: i,
                            value: result.rate
                        });
                        rec.setSublistValue({
                            sublistId: 'item',
                            fieldId: 'amount',
                            line: i,
                            value: lib.round(result.rate * quantity)
                        });
                    } else {
                        log.audit('PO line not auto-priced',
                            'Line ' + (i + 1) + ', item ' + itemId + ': ' + result.status + ' - ' + (result.message || ''));
                    }
                }
            } catch (e) {
                log.error('error @ beforeSubmit', (e && e.name) + ': ' + (e && e.message) + ' | ' + (e && e.stack));
            }
        }

        /**
         * Defines the function definition that is executed after record is submitted.
         * @param {Object} scriptContext
         * @param {Record} scriptContext.newRecord - New record
         * @param {Record} scriptContext.oldRecord - Old record
         * @param {string} scriptContext.type - Trigger type; use values from the context.UserEventType enum
         * @since 2015.2
         */
        const afterSubmit = (scriptContext) => {

        }

        return { beforeLoad, beforeSubmit, afterSubmit }

    });