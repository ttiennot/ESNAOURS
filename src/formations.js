'use strict';
/* Positions (x, y en %) sur un demi-terrain vertical : y=0 en haut (attaque), y=100 en bas (gardien). */
const L = (label, x, y) => ({ label, x, y });
const GK = L('GB', 50, 90);
const def4 = [L('DG', 14, 70), L('DC', 37, 74), L('DC', 63, 74), L('DD', 86, 70)];
const def3 = [L('DC', 27, 73), L('DC', 50, 75), L('DC', 73, 73)];
const def5 = [L('PG', 8, 64), L('DC', 29, 73), L('DC', 50, 75), L('DC', 71, 73), L('PD', 92, 64)];

const FORMATIONS = {
  '4-4-2': [GK, ...def4, L('MG', 14, 45), L('MC', 37, 49), L('MC', 63, 49), L('MD', 86, 45), L('BU', 37, 20), L('BU', 63, 20)],
  '4-3-3': [GK, ...def4, L('MC', 27, 49), L('MC', 50, 53), L('MC', 73, 49), L('AG', 16, 22), L('BU', 50, 16), L('AD', 84, 22)],
  '4-2-3-1': [GK, ...def4, L('MDC', 37, 56), L('MDC', 63, 56), L('MG', 16, 34), L('MOC', 50, 36), L('MD', 84, 34), L('BU', 50, 14)],
  '4-5-1': [GK, ...def4, L('MG', 10, 42), L('MC', 30, 50), L('MC', 50, 46), L('MC', 70, 50), L('MD', 90, 42), L('BU', 50, 16)],
  '3-5-2': [GK, ...def3, L('PG', 9, 46), L('MC', 30, 52), L('MOC', 50, 42), L('MC', 70, 52), L('PD', 91, 46), L('BU', 37, 18), L('BU', 63, 18)],
  '3-4-3': [GK, ...def3, L('MG', 14, 47), L('MC', 37, 51), L('MC', 63, 51), L('MD', 86, 47), L('AG', 18, 22), L('BU', 50, 16), L('AD', 82, 22)],
  '5-3-2': [GK, ...def5, L('MC', 27, 46), L('MC', 50, 50), L('MC', 73, 46), L('BU', 37, 19), L('BU', 63, 19)],
  '5-4-1': [GK, ...def5, L('MG', 14, 44), L('MC', 37, 48), L('MC', 63, 48), L('MD', 86, 44), L('BU', 50, 17)]
};

module.exports = { FORMATIONS };
