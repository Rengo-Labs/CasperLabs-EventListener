const sleep = (num) => {
    return new Promise((resolve) => setTimeout(resolve, num));
};
async function calculateRPCCallTime()
{
    await sleep(5000);
    throw "RPC is not responding...";
}

// to get block data of a node against block height
async function getblockData() {
    try {
        let blocksResponse=await casperService.getBlockInfoByHeight(height);
    //  calculateRPCCallTime()
    // .catch(function(error) {
    //     throw error;
    // });
        const timeout = setTimeout(() => {
            controller.abort();
        }, 5000);

    } catch (error) {
     
      console.log("error is : ",error);
     
    } 
}
getblockData();