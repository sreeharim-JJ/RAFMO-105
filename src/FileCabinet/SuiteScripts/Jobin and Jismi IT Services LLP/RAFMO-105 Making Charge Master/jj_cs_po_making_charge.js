/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
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
 * Description : Purchase Order client script (create / edit) that calculates the item line rate and amount live in the
 *               browser using jj_lib_making_charge. Only APPROVED, effective Making Charge records are used.
 *                 - postSourcing (item)           : calculates the rate after item sourcing so it is not overwritten;
 *                                                   alerts when Vendor/Date is missing or no rate / making charge exists.
 *                 - fieldChanged (quantity)       : updates the line amount.
 *                 - fieldChanged (entity, trandate, currency) : recalculates all item lines.
 *                 - validateLine                  : re-verifies the rate before the line is committed.
 *                 - saveRecord                    : blocks save with a "Rate mismatch" alert when a priced line differs
 *                                                   from the calculated making charge rate (tolerance 0.005).
 *
 * REVISION HISTORY :
 *
 * @version 1.0 RAFMO-105 : 20-November-2026 : Created the initial build by JJ0494
 *
 * *********************************************************************************************************************************
 */
define(['N/ui/dialog', './jj_cm_charge_master_rafmo105'],
    (dialog, lib) => {

    let isRecalculating = false;   // guard against re-entrant events

    /**
     * Function to be executed after page is initialized.
     *
     * @param {Object} scriptContext
     * @param {Record} scriptContext.currentRecord - Current form record
     * @param {string} scriptContext.mode - The mode in which the record is being accessed (create, copy, or edit)
     *
     * @since 2015.2
     */
    function pageInit(scriptContext) {
        console.log('[MC] client script loaded, mode: ' + scriptContext.mode);
    }

    /**
     * Function to be executed when field is changed.
     *
     * @param {Object} scriptContext
     * @param {Record} scriptContext.currentRecord - Current form record
     * @param {string} scriptContext.sublistId - Sublist name
     * @param {string} scriptContext.fieldId - Field name
     * @param {number} scriptContext.lineNum - Line number. Will be undefined if not a sublist or matrix field
     * @param {number} scriptContext.columnNum - Line number. Will be undefined if not a matrix field
     *
     * @since 2015.2
     */
    function fieldChanged(scriptContext) {
        try {
            if (isRecalculating) return;
            let rec = scriptContext.currentRecord;

            if (scriptContext.sublistId === 'item' && scriptContext.fieldId === 'quantity') {
                applyToCurrentLine(rec, false);
                return;
            }
            if (!scriptContext.sublistId &&
                ['entity', 'trandate', 'currency'].indexOf(scriptContext.fieldId) !== -1) {
                recalculateAllLines(rec);
            }
        } catch (e) {
            console.error('[MC] error @ fieldChanged', e && e.name, e && e.message, e && e.stack);
        }
    }

    /**
     * Function to be executed when field is slaved.
     * Runs after item sourcing, so the calculated rate is not overwritten.
     *
     * @param {Object} scriptContext
     * @param {Record} scriptContext.currentRecord - Current form record
     * @param {string} scriptContext.sublistId - Sublist name
     * @param {string} scriptContext.fieldId - Field name
     *
     * @since 2015.2
     */
    function postSourcing(scriptContext) {
        try {
            if (scriptContext.sublistId === 'item' && scriptContext.fieldId === 'item') {
                console.log('[MC] postSourcing item');
                applyToCurrentLine(scriptContext.currentRecord, true);
            }
        } catch (e) {
            console.error('[MC] error @ postSourcing', e && e.name, e && e.message, e && e.stack);
        }
    }

    /**
     * Function to be executed after sublist is inserted, removed, or edited.
     *
     * @param {Object} scriptContext
     * @param {Record} scriptContext.currentRecord - Current form record
     * @param {string} scriptContext.sublistId - Sublist name
     *
     * @since 2015.2
     */
    function sublistChanged(scriptContext) {

    }

    /**
     * Function to be executed after line is selected.
     *
     * @param {Object} scriptContext
     * @param {Record} scriptContext.currentRecord - Current form record
     * @param {string} scriptContext.sublistId - Sublist name
     *
     * @since 2015.2
     */
    function lineInit(scriptContext) {

    }

    /**
     * Validation function to be executed when field is changed.
     *
     * @param {Object} scriptContext
     * @param {Record} scriptContext.currentRecord - Current form record
     * @param {string} scriptContext.sublistId - Sublist name
     * @param {string} scriptContext.fieldId - Field name
     * @param {number} scriptContext.lineNum - Line number. Will be undefined if not a sublist or matrix field
     * @param {number} scriptContext.columnNum - Line number. Will be undefined if not a matrix field
     *
     * @returns {boolean} Return true if field is valid
     *
     * @since 2015.2
     */
    function validateField(scriptContext) {
        return true;
    }

    /**
     * Validation function to be executed when sublist line is committed.
     *
     * @param {Object} scriptContext
     * @param {Record} scriptContext.currentRecord - Current form record
     * @param {string} scriptContext.sublistId - Sublist name
     *
     * @returns {boolean} Return true if sublist line is valid
     *
     * @since 2015.2
     */
    function validateLine(scriptContext) {
        try {
            if (isRecalculating) return true;   // line already calculated by recalculateAllLines
            if (scriptContext.sublistId === 'item') {
                applyToCurrentLine(scriptContext.currentRecord, false);
            }
        } catch (e) {
            console.error('[MC] error @ validateLine', e && e.name, e && e.message, e && e.stack);
        }
        return true;
    }

    /**
     * Validation function to be executed when sublist line is inserted.
     *
     * @param {Object} scriptContext
     * @param {Record} scriptContext.currentRecord - Current form record
     * @param {string} scriptContext.sublistId - Sublist name
     *
     * @returns {boolean} Return true if sublist line is valid
     *
     * @since 2015.2
     */
    function validateInsert(scriptContext) {
        return true;
    }

    /**
     * Validation function to be executed when record is deleted.
     *
     * @param {Object} scriptContext
     * @param {Record} scriptContext.currentRecord - Current form record
     * @param {string} scriptContext.sublistId - Sublist name
     *
     * @returns {boolean} Return true if sublist line is valid
     *
     * @since 2015.2
     */
    function validateDelete(scriptContext) {
        return true;
    }

    /**
     * Validation function to be executed when record is saved.
     * Verifies that every priced line matches the calculated making charge rate.
     *
     * @param {Object} scriptContext
     * @param {Record} scriptContext.currentRecord - Current form record
     * @returns {boolean} Return true if record is valid
     *
     * @since 2015.2
     */
    function saveRecord(scriptContext) {
        try {
            let rec = scriptContext.currentRecord;
            let vendorId = rec.getValue({ fieldId: 'entity' });
            let tranDate = rec.getValue({ fieldId: 'trandate' });
            let currencyId = rec.getValue({ fieldId: 'currency' });
            if (!vendorId || !tranDate) return true;

            let cache = {};   // one calculation per item for this save
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
                if (result.status !== 'OK') continue;

                let rate = lib.num(rec.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'rate',
                    line: i
                }));
                if (Math.abs(rate - result.rate) > 0.005) {
                    dialog.alert({
                        title: 'Rate mismatch',
                        message: 'Line ' + (i + 1) + ': rate ' + rate + ' does not match the calculated making charge rate ' +
                            result.rate + '. Please re-select the item or correct the rate.'
                    });
                    return false;
                }
            }
        } catch (e) {
            console.error('[MC] error @ saveRecord', e && e.name, e && e.message, e && e.stack);
        }
        return true;
    }

    /**
     * Calculates and sets rate and amount on the currently selected item line.
     * @param {Record} rec - current record
     * @param {boolean} alertOnMissing - show a dialog when vendor/date or a rate/charge is missing
     * @param {Object} [cache] - optional per-run cache of computed rates keyed by item id
     */
    function applyToCurrentLine(rec, alertOnMissing, cache) {
        let itemId = rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'item' });
        let vendorId = rec.getValue({ fieldId: 'entity' });
        let tranDate = rec.getValue({ fieldId: 'trandate' });
        let currencyId = rec.getValue({ fieldId: 'currency' });
        console.log('[MC] applyToCurrentLine', JSON.stringify({ itemId: itemId, vendorId: vendorId, date: String(tranDate), currencyId: currencyId }));
        if (!itemId) return;

        if (!vendorId || !tranDate) {
            if (alertOnMissing) {
                dialog.alert({
                    title: 'Making Charge',
                    message: 'Select the Vendor and Date before adding items so the rate can be calculated.'
                });
            }
            return;
        }

        let result;
        if (cache && cache[itemId]) {
            result = cache[itemId];
        } else {
            result = lib.computeLineRate(itemId, vendorId, tranDate, currencyId);
            if (cache) cache[itemId] = result;
        }
        console.log('[MC] result', JSON.stringify(result));
        if (result.status !== 'OK') {
            // Unapproved / missing making charge is never applied
            if (alertOnMissing && result.status !== 'NO_PURITY') {
                dialog.alert({ title: 'Making Charge', message: result.message });
            }
            return;
        }

        let quantity = lib.num(rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity' }));
        isRecalculating = true;
        try {
            rec.setCurrentSublistValue({
                sublistId: 'item',
                fieldId: 'rate',
                value: result.rate,
                ignoreFieldChange: true
            });
            rec.setCurrentSublistValue({
                sublistId: 'item',
                fieldId: 'amount',
                value: lib.round(result.rate * quantity),
                ignoreFieldChange: true
            });
        } finally {
            isRecalculating = false;
        }
    }

    /**
     * Recalculates every item line (used when vendor, date or currency changes).
     * @param {Record} rec - current record
     */
    function recalculateAllLines(rec) {
        let cache = {};
        let lineCount = rec.getLineCount({ sublistId: 'item' });
        for (let i = 0; i < lineCount; i++) {
            rec.selectLine({ sublistId: 'item', line: i });
            applyToCurrentLine(rec, false, cache);
            isRecalculating = true;   // skip validateLine's second calculation on commit
            try {
                rec.commitLine({ sublistId: 'item' });
            } finally {
                isRecalculating = false;
            }
        }
    }

    return {
        pageInit: pageInit,
        fieldChanged: fieldChanged,
        postSourcing: postSourcing,
        validateLine: validateLine,
        validateInsert: validateInsert,
        validateDelete: validateDelete,
        saveRecord: saveRecord
    };

});