export interface IDCExpectedResponse {
    checkFn: (data) => boolean;
    processFn: (data) => any;
}
